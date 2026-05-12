import { useEffect, useMemo, useState } from "react";
import { createJob, fetchJob, fetchQuotaSummary, runExport, runStage } from "./lib/api";
import type { CreateJobInput, CreatorResult, JobDetailResponse, QuotaSummary, ResultStatus } from "./types";

const defaultForm: CreateJobInput = {
  keyword: "",
  lookback_days: 14,
  subscriber_min: 100,
  subscriber_max: 5000000,
  max_candidates: 500,
  shortlist_size: 100,
  minimum_pre_score: 0,
  channel_country: ""
};

type AppMode = "home" | "workspace";
type SortDirection = "asc" | "desc";
type SortKey =
  | "title"
  | "channel_title"
  | "subscribers"
  | "views"
  | "channel_country"
  | "video_language"
  | "status";

const stageLabelMap = {
  created: "已创建",
  search: "候选搜索",
  enrichment: "指标补全",
  pre_score: "预评分",
  shortlist: "已生成入围",
  export: "已导出",
  done: "完成",
  failed: "失败"
} as const;

const statusLabelMap: Record<ResultStatus, string> = {
  candidate: "候选",
  enriched: "已补全",
  pre_scored: "已预评分",
  shortlisted: "已入围",
  exported: "已导出",
  rejected: "已淘汰",
  failed: "失败"
};

function normalizeAvatarUrl(url: string): string {
  return url.replace("https://yt3.ggpht.com/", "https://yt3.googleusercontent.com/");
}

function ChannelAvatar(props: {
  url?: string | null;
  label: string;
  size: "row" | "detail";
}) {
  const [failed, setFailed] = useState(false);
  const initials = props.label.slice(0, props.size === "detail" ? 2 : 1).toUpperCase() || "?";

  useEffect(() => {
    setFailed(false);
  }, [props.url]);

  if (props.url && !failed) {
    return (
      <img
        className={props.size === "detail" ? "detail-avatar-image" : "row-avatar-image"}
        src={normalizeAvatarUrl(props.url)}
        alt={props.label}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return <div className={props.size === "detail" ? "detail-avatar" : "row-avatar"}>{initials}</div>;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  }
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatCountrySource(value: string | null | undefined): string {
  switch (value) {
    case "youtube_about_popup":
      return "主页更多";
    case "youtube_api":
      return "API";
    case "metadata_keyword":
      return "文案判断";
    default:
      return "未标注";
  }
}

function normalizeCountryCode(value: string | null | undefined): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return "";
  const upper = normalized.toUpperCase();
  const aliases: Record<string, string[]> = {
    PH: ["PH", "PHILIPPINES", "FILIPINO", "PINOY", "菲律宾", "菲律賓"],
    ID: ["ID", "INDONESIA", "INDONESIAN", "INDO"],
    TH: ["TH", "THAILAND", "THAI"],
    BR: ["BR", "BRAZIL", "BRASIL", "BRAZILIAN"],
    SG: ["SG", "SINGAPORE", "SINGAPOREAN"],
    MY: ["MY", "MALAYSIA", "MALAYSIAN"],
    VN: ["VN", "VIETNAM", "VIETNAMESE"],
    KR: ["KR", "KOREA", "SOUTH KOREA", "KOREAN"],
    JP: ["JP", "JAPAN", "JAPANESE"],
    TW: ["TW", "TAIWAN", "TAIWANESE"],
    US: ["US", "UNITED STATES", "USA", "AMERICA", "AMERICAN"]
  };

  for (const [code, values] of Object.entries(aliases)) {
    if (values.includes(upper) || values.includes(normalized)) return code;
  }
  return upper;
}

function allowsCountryDisplay(selectedCountry: string, resultCountryRaw: string | null | undefined): boolean {
  const resultCountry = normalizeCountryCode(resultCountryRaw);
  if (!selectedCountry) return true;
  return resultCountry === selectedCountry || !resultCountry;
}

function compareValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
  direction: SortDirection
): number {
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof left === "number" || typeof right === "number") {
    const leftValue = typeof left === "number" ? left : Number.NEGATIVE_INFINITY;
    const rightValue = typeof right === "number" ? right : Number.NEGATIVE_INFINITY;
    return (leftValue - rightValue) * multiplier;
  }

  return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN") * multiplier;
}

function sortResults(results: CreatorResult[], sortKey: SortKey, sortDirection: SortDirection): CreatorResult[] {
  return [...results].sort((left, right) => {
    const compared = compareValues(left[sortKey], right[sortKey], sortDirection);
    if (compared !== 0) return compared;
    const viewCompared = compareValues(left.views, right.views, "desc");
    if (viewCompared !== 0) return viewCompared;
    return compareValues(left.subscribers, right.subscribers, "desc");
  });
}

function dedupeChannelResults(results: CreatorResult[]): CreatorResult[] {
  const bestByChannel = new Map<string, CreatorResult>();

  for (const result of results) {
    const key = result.channel_id || `title:${(result.channel_title ?? result.title ?? "").trim().toLowerCase()}`;
    const current = bestByChannel.get(key);
    if (!current) {
      bestByChannel.set(key, result);
      continue;
    }

    const currentSource = formatCountrySource(current.channel_country_source);
    const nextSource = formatCountrySource(result.channel_country_source);
    const currentRank =
      currentSource === "主页更多" ? 4 : currentSource === "API" ? 3 : currentSource === "文案判断" ? 2 : currentSource === "未标注" ? 0 : 1;
    const nextRank =
      nextSource === "主页更多" ? 4 : nextSource === "API" ? 3 : nextSource === "文案判断" ? 2 : nextSource === "未标注" ? 0 : 1;

    if (
      nextRank > currentRank ||
      (nextRank === currentRank && (result.views ?? 0) > (current.views ?? 0)) ||
      (nextRank === currentRank && (result.views ?? 0) === (current.views ?? 0) && (result.subscribers ?? 0) > (current.subscribers ?? 0))
    ) {
      bestByChannel.set(key, result);
    }
  }

  return [...bestByChannel.values()];
}

function summarizeActionResult(action: string, payload: unknown): string {
  const data = payload as Record<string, unknown>;

  switch (action) {
    case "run-search":
      return `候选搜索完成，新增 ${data.candidate_count ?? 0} 条结果。`;
    case "run-enrichment":
      return `指标补全完成，视频 ${data.video_metric_count ?? 0} 条，频道 ${data.channel_metric_count ?? 0} 条。`;
    case "run-pre-score":
      return `预评分完成，已计算 ${data.scored_count ?? 0} 条，跳过 ${data.skipped_count ?? 0} 条。`;
    case "run-shortlist":
      return `入围生成完成，入围 ${data.shortlisted_count ?? 0} 条，淘汰 ${data.rejected_count ?? 0} 条。`;
    default:
      return "操作已完成。";
  }
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("home");
  const [form, setForm] = useState<CreateJobInput>(defaultForm);
  const [jobData, setJobData] = useState<JobDetailResponse | null>(null);
  const [selectedResult, setSelectedResult] = useState<CreatorResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaSummary, setQuotaSummary] = useState<QuotaSummary | null>(null);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);

  const [filterSubscriberMin, setFilterSubscriberMin] = useState<number>(100);
  const [filterSubscriberMax, setFilterSubscriberMax] = useState<number>(5000000);
  const [filterStatus, setFilterStatus] = useState<ResultStatus | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  async function refreshQuotaSummary(): Promise<void> {
    try {
      const quota = await fetchQuotaSummary();
      setQuotaSummary(quota);
    } catch {
      setQuotaSummary(null);
    }
  }

  useEffect(() => {
    void refreshQuotaSummary();
  }, []);

  useEffect(() => {
    if (!jobData?.results?.length) {
      setSelectedResult(null);
      return;
    }

    setSelectedResult((current) => {
      if (current) {
        const stillExists = jobData.results.find((item) => item.id === current.id);
        if (stillExists) return stillExists;
      }
      return jobData.results[0] ?? null;
    });
  }, [jobData]);

  const filteredResults = useMemo(() => {
    const results = dedupeChannelResults(jobData?.results ?? []);
    const selectedCountry = normalizeCountryCode(jobData?.job.channel_country || form.channel_country);
    return sortResults(
      results.filter((result) => {
        return (
          allowsCountryDisplay(selectedCountry, result.channel_country) &&
          result.subscribers >= filterSubscriberMin &&
          result.subscribers <= filterSubscriberMax &&
          (filterStatus === "all" || result.status === filterStatus)
        );
      }),
      sortKey,
      sortDirection
    );
  }, [form.channel_country, jobData, filterStatus, filterSubscriberMax, filterSubscriberMin, sortDirection, sortKey]);

  const shortlistedCount = useMemo(
    () => dedupeChannelResults((jobData?.results ?? []).filter((result) => result.status === "shortlisted")).length,
    [jobData]
  );

  const matchedCountryCount = useMemo(() => {
    const selectedCountry = normalizeCountryCode(jobData?.job.channel_country);
    if (!selectedCountry) return null;
    return dedupeChannelResults(jobData?.results ?? []).filter((result) => normalizeCountryCode(result.channel_country) === selectedCountry).length;
  }, [jobData]);

  const averageViews = useMemo(() => {
    const values = dedupeChannelResults(jobData?.results ?? []).map((result) => result.views).filter((value): value is number => value !== null && value !== undefined);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [jobData]);

  const weakCountryCount = useMemo(
    () =>
      dedupeChannelResults(jobData?.results ?? []).filter((result) =>
        ["metadata_keyword", "language_hint"].includes(result.channel_country_source ?? "")
      ).length,
    [jobData]
  );

  function setFormField<Key extends keyof CreateJobInput>(key: Key, value: CreateJobInput[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSort(nextKey: SortKey) {
    setSortDirection((currentDirection) => {
      if (sortKey === nextKey) return currentDirection === "asc" ? "desc" : "asc";
      return nextKey === "title" || nextKey === "channel_title" || nextKey === "status" || nextKey === "channel_country" || nextKey === "video_language" ? "asc" : "desc";
    });
    setSortKey(nextKey);
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  async function refreshJob(jobId: string) {
    const detail = await fetchJob(jobId);
    setJobData(detail);
    return detail;
  }

  async function runDefaultPipeline(keywordOverride?: string) {
    const keyword = (keywordOverride ?? form.keyword).trim();
    if (!keyword) {
      setError("请输入关键词后再开始搜索。");
      return;
    }

    setLoading("search");
    setError(null);
    setMessage(null);

    try {
      const normalizedCountry = normalizeCountryCode(form.channel_country);
      const input: CreateJobInput = {
        ...form,
        keyword,
        ...(normalizedCountry ? { channel_country: normalizedCountry } : { channel_country: undefined })
      };
      setForm(input);
      const job = await createJob(input);
      await runStage(job.id, "run-search");
      await runStage(job.id, "run-enrichment");
      await runStage(job.id, "run-pre-score");
      await runStage(job.id, "run-shortlist");
      await refreshJob(job.id);
      await refreshQuotaSummary();
      setMode("workspace");
      setShowSearchOverlay(false);
      setMessage(
        normalizedCountry
          ? `已完成“${keyword}”的候选搜索、描述关键词校验和 ${normalizedCountry} 国家判断。弱证据频道也会保留给你判断。`
          : `已完成“${keyword}”的候选搜索、描述关键词校验和基础补全。`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "搜索失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  async function handleStage(action: "run-shortlist") {
    if (!jobData) return;
    setLoading(action);
    setError(null);
    setMessage(null);

    try {
      const payload = await runStage(jobData.job.id, action);
      await refreshJob(jobData.job.id);
      setMessage(summarizeActionResult(action, payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  async function handleExport() {
    if (!jobData) return;
    setLoading("export");
    setError(null);
    setMessage(null);

    try {
      const result = await runExport(jobData.job.id, "xlsx");
      await refreshJob(jobData.job.id);
      const savedPath = result.file_path ?? result.filename ?? "backend/data/exports";
      setMessage(`Excel 已生成到本地：${savedPath}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  const currentStage = jobData ? stageLabelMap[jobData.job.stage] ?? jobData.job.stage : "未开始";
  const currentKeyword = jobData
    ? `${jobData.job.keyword}${jobData.job.channel_country ? ` · ${jobData.job.channel_country}` : ""}`
    : "未运行任务";

  if (mode === "home") {
    return (
      <div className="landing-shell">
        <div className="landing-grid" />
        <div className="landing-glow landing-glow--left" />
        <div className="landing-glow landing-glow--right" />
        <div className="landing-glow landing-glow--bottom" />
        <div className="landing-particle landing-particle--one" />
        <div className="landing-particle landing-particle--two" />
        <div className="landing-particle landing-particle--three" />

        <main className="landing-main">
          <section className="landing-hero">
            <h1>YouTube 创作者雷达</h1>
            <div className="landing-search">
              <input
                value={form.keyword}
                onChange={(event) => setFormField("keyword", event.target.value)}
                placeholder="搜索创作者、关键词或趋势方向..."
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runDefaultPipeline();
                  }
                }}
              />
              <button type="button" onClick={() => void runDefaultPipeline()} disabled={loading === "search"}>
                {loading === "search" ? "搜索中..." : "开始搜索"}
              </button>
            </div>
            {jobData ? (
              <div className="landing-return">
                <button type="button" className="landing-return__button" onClick={() => setMode("workspace")}>
                  返回工作台
                </button>
                <div className="landing-return__text">当前保留任务：{jobData.job.keyword}</div>
              </div>
            ) : null}
            {error ? <div className="error-banner" style={{ marginTop: 18 }}>{error}</div> : null}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      {showSearchOverlay ? (
        <div className="search-overlay" onClick={() => setShowSearchOverlay(false)}>
          <div className="search-overlay__panel" onClick={(event) => event.stopPropagation()}>
            <div className="search-overlay__title">新建搜索任务</div>
            <div className="landing-search">
              <input
                value={form.keyword}
                onChange={(event) => setFormField("keyword", event.target.value)}
                placeholder="输入关键词，使用默认参数快速开始..."
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runDefaultPipeline();
                  }
                }}
              />
              <button type="button" onClick={() => void runDefaultPipeline()} disabled={loading === "search"}>
                {loading === "search" ? "搜索中..." : "开始搜索"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand__logo">✦</div>
          <div>
            <div className="sidebar-brand__title">Discovery Engine</div>
            <div className="sidebar-brand__meta">Local Pipeline</div>
          </div>
        </div>

        <button type="button" className="sidebar-primary-button" onClick={() => setShowSearchOverlay(true)}>
          ＋ 新建搜索任务
        </button>

        <nav className="sidebar-nav">
          <button type="button" className="sidebar-link sidebar-link--active">发现中心</button>
        </nav>

        <div className="quota-panel">
          <div className="quota-panel__label">API 额度</div>
          <div className="quota-panel__value">{quotaSummary ? `${quotaSummary.used_units} / ${quotaSummary.daily_limit}` : "-- / --"}</div>
          <div className="quota-panel__progress">
            <div className="quota-panel__progress-bar" style={{ width: `${quotaSummary?.percent_used ?? 0}%` }} />
          </div>
          <div className="quota-panel__meta">
            <span>剩余 {quotaSummary ? quotaSummary.remaining_units : "--"}</span>
            <span>{quotaSummary ? `${quotaSummary.percent_used.toFixed(1)}%` : "--"}</span>
          </div>
          <div className="quota-panel__date">
            {quotaSummary ? `按太平洋时间 ${quotaSummary.usage_date} 统计` : "读取中..."}
          </div>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="top-bar">
          <button type="button" className="dashboard-action dashboard-action--primary top-bar__home-button" onClick={() => setMode("home")}>
            首页
          </button>
          <div className="top-bar__actions">
            <button type="button" className="dashboard-action" onClick={() => void handleStage("run-shortlist")} disabled={!jobData || loading === "run-shortlist"}>
              {loading === "run-shortlist" ? "生成中..." : "生成入围"}
            </button>
            <button type="button" className="dashboard-action dashboard-action--primary" onClick={() => void handleExport()} disabled={!jobData || loading === "export"}>
              {loading === "export" ? "导出中..." : "导出 XLSX"}
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          <section className="hero-layout">
            <div className="hero-copy-card">
              <div className="eyebrow-badge">
                <span className="eyebrow-dot" />
                Creator Discovery
              </div>
              <h1>YouTube潜力股挖掘.</h1>
              <p>用关键词快速扫描近期表现强于账号体量的 YouTube 创作者。先完成候选搜索、指标补全和预评分，再决定是否生成入围。</p>
            </div>

            <div className="hero-search-panel">
              <div className="hero-search-panel__glow" />
              <div className="hero-search-panel__content">
                <div className="hero-search-row">
                  <input
                    value={form.keyword}
                    onChange={(event) => setFormField("keyword", event.target.value)}
                    placeholder="输入你自己想搜的关键词，我们不会自动扩词..."
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void runDefaultPipeline();
                      }
                    }}
                  />
                  <button type="button" onClick={() => void runDefaultPipeline()} disabled={loading === "search"}>
                    {loading === "search" ? "搜索中..." : "开始搜索"}
                  </button>
                </div>
                <div className="hero-config-grid">
                  <label>
                    <span>国家/地区</span>
                    <input
                      value={form.channel_country ?? ""}
                      onChange={(event) => setFormField("channel_country", normalizeCountryCode(event.target.value))}
                      placeholder="留空不限，例如 PH 或 菲律宾"
                    />
                  </label>
                  <label>
                    <span>回看天数</span>
                    <input type="number" value={14} readOnly />
                  </label>
                  <label>
                    <span>最大候选数</span>
                    <input
                      type="number"
                      value={form.max_candidates}
                      min={1}
                      onChange={(event) => setFormField("max_candidates", Number(event.target.value) || 500)}
                    />
                  </label>
                  <label>
                    <span>入围数量</span>
                    <input type="number" value={100} readOnly />
                  </label>
                  <label>
                    <span>最小粉丝数</span>
                    <input type="number" value={form.subscriber_min} onChange={(event) => setFormField("subscriber_min", Number(event.target.value) || 100)} />
                  </label>
                    <label>
                      <span>最大粉丝数</span>
                      <input type="number" value={5000000} readOnly />
                    </label>
                  </div>
              </div>
            </div>
          </section>

          <section className="stat-grid">
            <div className="stat-panel">
              <div className="stat-label">当前任务</div>
              <div className="stat-value stat-value--truncate">{currentKeyword}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">当前阶段</div>
              <div className="stat-value">{currentStage}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">结果总数</div>
              <div className="stat-value">{filteredResults.length}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">国家命中</div>
              <div className="stat-value">{matchedCountryCount ?? "-"}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">已入围</div>
              <div className="stat-value">{shortlistedCount}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">弱证据命中</div>
              <div className="stat-value">{weakCountryCount}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">平均播放量</div>
              <div className="stat-value">{averageViews ? formatCompactNumber(Math.round(averageViews)) : "-"}</div>
            </div>
          </section>

          {message ? <div className="success-banner">{message}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}

          <section className="workspace-grid">
            <section className="workspace-panel workspace-panel--table">
              <div className="workspace-panel__header">
                <div>
                  <h2>候选结果</h2>
                  <p>结果会先经过视频描述 / tags 的关键词校验，再按国家证据、播放量和粉丝数排序。</p>
                </div>
              </div>

              <div className="filter-chip-row">
                <label>
                  <span>最小粉丝数</span>
                  <input type="number" value={filterSubscriberMin} onChange={(event) => setFilterSubscriberMin(Number(event.target.value) || 0)} />
                </label>
                <label>
                  <span>最大粉丝数</span>
                  <input type="number" value={filterSubscriberMax} onChange={(event) => setFilterSubscriberMax(Number(event.target.value) || 0)} />
                </label>
                <label>
                  <span>状态</span>
                  <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as ResultStatus | "all")}>
                    <option value="all">全部</option>
                    <option value="candidate">候选</option>
                    <option value="enriched">已补全</option>
                    <option value="pre_scored">已预评分</option>
                    <option value="shortlisted">已入围</option>
                    <option value="exported">已导出</option>
                    <option value="rejected">已淘汰</option>
                    <option value="failed">失败</option>
                  </select>
                </label>
              </div>

              <div className="results-table-wrap">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th><button className="sort-button" onClick={() => handleSort("title")}>标题{sortIndicator("title")}</button></th>
                      <th><button className="sort-button" onClick={() => handleSort("channel_title")}>频道{sortIndicator("channel_title")}</button></th>
                      <th><button className="sort-button" onClick={() => handleSort("channel_country")}>国家{sortIndicator("channel_country")}</button></th>
                      <th><button className="sort-button" onClick={() => handleSort("video_language")}>语言{sortIndicator("video_language")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("subscribers")}>粉丝{sortIndicator("subscribers")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("views")}>播放量{sortIndicator("views")}</button></th>
                      <th><span className="table-label">国家来源</span></th>
                      <th className="centered"><button className="sort-button" onClick={() => handleSort("status")}>状态{sortIndicator("status")}</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((result) => (
                      <tr key={result.id} onClick={() => setSelectedResult(result)} className={selectedResult?.id === result.id ? "selected" : undefined}>
                        <td>
                          <div className="channel-cell">
                            <ChannelAvatar
                              url={result.channel_avatar_url}
                              label={result.channel_title ?? result.title ?? "?"}
                              size="row"
                            />
                            <div className="channel-cell__content">
                              <div className="channel-cell__title">{result.title ?? "-"}</div>
                              <div className="channel-cell__meta">{result.channel_title ?? "-"}</div>
                            </div>
                          </div>
                        </td>
                        <td>{result.channel_title ?? "-"}</td>
                        <td>{result.channel_country || "无"}</td>
                        <td>{result.video_language || "无"}</td>
                        <td className="numeric">{formatCompactNumber(result.subscribers)}</td>
                        <td className="numeric">{formatCompactNumber(result.views)}</td>
                        <td>{formatCountrySource(result.channel_country_source)}</td>
                        <td className="centered"><span className={`status-pill status-pill--${result.status}`}>{statusLabelMap[result.status] ?? result.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="workspace-panel workspace-panel--detail">
              {selectedResult ? (
                <>
                  <div className="detail-cover">
                    <div className="detail-cover__overlay" />
                    <div className="detail-cover__content">
                      <ChannelAvatar
                        url={selectedResult.channel_avatar_url}
                        label={selectedResult.channel_title ?? selectedResult.title ?? "频道头像"}
                        size="detail"
                      />
                      <div>
                        <h3>{selectedResult.channel_title ?? "未命名频道"}</h3>
                        <a href={selectedResult.video_url} target="_blank" rel="noreferrer">{selectedResult.video_url.replace("https://www.", "")}</a>
                      </div>
                    </div>
                  </div>

                  <div className="detail-body">
                    <section className="detail-section">
                      <h4>基础指标</h4>
                      <div className="metric-grid">
                        <div className="metric-card"><span>粉丝数</span><strong>{formatCompactNumber(selectedResult.subscribers)}</strong></div>
                        <div className="metric-card"><span>播放量</span><strong>{formatCompactNumber(selectedResult.views)}</strong></div>
                        <div className="metric-card"><span>国家</span><strong>{selectedResult.channel_country || "无"}</strong></div>
                        <div className="metric-card"><span>视频语言</span><strong>{selectedResult.video_language || "无"}</strong></div>
                      </div>
                    </section>

                    <section className="detail-section">
                      <h4>国家证据</h4>
                      <div className="detail-list">
                        <div className="detail-list__item"><span>国家来源</span><strong>{formatCountrySource(selectedResult.channel_country_source)}</strong></div>
                        <div className="detail-list__item"><span>频道状态</span><strong>{statusLabelMap[selectedResult.status] ?? selectedResult.status}</strong></div>
                        <div className="detail-list__item"><span>发布时间</span><strong>{selectedResult.published_at ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>发布天数</span><strong>{selectedResult.days_since_publish ?? "-"}</strong></div>
                      </div>
                    </section>

                    <section className="detail-section">
                      <h4>辅助信息</h4>
                      <div className="detail-list">
                        <div className="detail-list__item"><span>点赞数</span><strong>{formatCompactNumber(selectedResult.likes)}</strong></div>
                        <div className="detail-list__item"><span>评论数</span><strong>{formatCompactNumber(selectedResult.comments)}</strong></div>
                        <div className="detail-list__item"><span>搜索顺位</span><strong>{selectedResult.raw_search_rank ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>频道链接</span><strong>{selectedResult.channel_id ? `youtube.com/channel/${selectedResult.channel_id}` : "-"}</strong></div>
                      </div>
                    </section>

                    {selectedResult.video_description ? (
                      <section className="detail-section">
                        <h4>视频描述摘要</h4>
                        <p style={{ color: "rgba(225,230,255,0.82)", lineHeight: 1.7, margin: 0 }}>
                          {selectedResult.video_description.slice(0, 500)}
                          {selectedResult.video_description.length > 500 ? "..." : ""}
                        </p>
                      </section>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="detail-empty">
                  <h3>暂无详情</h3>
                  <p>先运行一次搜索，然后从左侧结果表中选择一条记录。</p>
                </div>
              )}
            </aside>
          </section>
        </main>
      </div>
    </div>
  );
}
