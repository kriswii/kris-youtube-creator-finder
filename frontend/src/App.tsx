import { useEffect, useMemo, useState } from "react";
import { createJob, fetchJob, fetchQuotaSummary, runExport, runStage } from "./lib/api";
import type { CreateJobInput, CreatorResult, JobDetailResponse, OpportunityTier, QuotaSummary, ResultStatus } from "./types";

const defaultForm: CreateJobInput = {
  keyword: "",
  lookback_days: 30,
  subscriber_min: 3000,
  subscriber_max: 50000,
  max_candidates: 50,
  shortlist_size: 20,
  minimum_pre_score: 55,
  channel_country: ""
};

type AppMode = "home" | "workspace";
type SortDirection = "asc" | "desc";
type SortKey =
  | "title"
  | "channel_title"
  | "subscribers"
  | "views"
  | "likes"
  | "comments"
  | "days_since_publish"
  | "engagement_rate"
  | "view_sub_ratio"
  | "pre_score"
  | "opportunity_tier"
  | "status";

const metricHelpText = {
  comment_rate: {
    label: "评论率",
    formula: "comments / max(views, 1)",
    meaning: "评论数占播放量的比例，越高通常说明观众更愿意表达观点。"
  },
  engagement_rate: {
    label: "互动率",
    formula: "(likes + comments * 2) / max(views, 1)",
    meaning: "综合点赞和评论的参与强度，其中评论权重更高。"
  },
  view_sub_ratio: {
    label: "播粉比",
    formula: "views / max(subscribers, 1)",
    meaning: "单条视频播放量相对于频道粉丝体量的表现。"
  },
  relative_velocity: {
    label: "相对传播速度",
    formula: "views / days_since_publish / max(subscribers, 1)",
    meaning: "考虑发布时间和账号体量后的传播效率。"
  },
  opportunity_tier: {
    label: "机会层级",
    formula: "A >= 85，B >= 70，C >= 55，D < 55",
    meaning: "按 Pre Score 分层，帮助快速判断优先关注范围。"
  },
  pre_score: {
    label: "Pre Score",
    formula:
      "30*sub_fit_score + 30*view_sub_score + 20*engagement_score + 10*comment_score + 10*relative_velocity_score",
    meaning: "基于固定规则计算的预评分，用来优先发现相对表现更强的创作者。"
  }
} as const;

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

function MetricHelp(props: { metric: keyof typeof metricHelpText; placement?: "default" | "top" }) {
  const info = metricHelpText[props.metric];
  const text = `${info.label}\n公式：${info.formula}\n意义：${info.meaning}`;

  return (
    <span
      className={`metric-help ${props.placement === "top" ? "metric-help--top" : ""}`}
      aria-label={text}
      data-tooltip={text}
      tabIndex={0}
    >
      ?
    </span>
  );
}

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
    return compareValues(left.pre_score, right.pre_score, "desc");
  });
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

  const [filterSubscriberMin, setFilterSubscriberMin] = useState<number>(3000);
  const [filterSubscriberMax, setFilterSubscriberMax] = useState<number>(50000);
  const [filterPreScoreMin, setFilterPreScoreMin] = useState<number>(55);
  const [filterTier, setFilterTier] = useState<OpportunityTier | "all">("all");
  const [filterStatus, setFilterStatus] = useState<ResultStatus | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("pre_score");
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
    const results = jobData?.results ?? [];
    return sortResults(
      results.filter((result) => {
        return (
          result.subscribers >= filterSubscriberMin &&
          result.subscribers <= filterSubscriberMax &&
          (result.pre_score ?? 0) >= filterPreScoreMin &&
          (filterTier === "all" || result.opportunity_tier === filterTier) &&
          (filterStatus === "all" || result.status === filterStatus)
        );
      }),
      sortKey,
      sortDirection
    );
  }, [jobData, filterPreScoreMin, filterStatus, filterSubscriberMax, filterSubscriberMin, filterTier, sortDirection, sortKey]);

  const shortlistedCount = useMemo(
    () => (jobData?.results ?? []).filter((result) => result.status === "shortlisted").length,
    [jobData]
  );

  const averagePreScore = useMemo(() => {
    const values = (jobData?.results ?? []).map((result) => result.pre_score).filter((value): value is number => value !== null && value !== undefined);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [jobData]);

  function setFormField<Key extends keyof CreateJobInput>(key: Key, value: CreateJobInput[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSort(nextKey: SortKey) {
    setSortDirection((currentDirection) => {
      if (sortKey === nextKey) return currentDirection === "asc" ? "desc" : "asc";
      return nextKey === "title" || nextKey === "channel_title" || nextKey === "status" || nextKey === "opportunity_tier" ? "asc" : "desc";
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
      const normalizedCountry = form.channel_country?.trim().toUpperCase();
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
      await refreshJob(job.id);
      await refreshQuotaSummary();
      setMode("workspace");
      setShowSearchOverlay(false);
      setMessage(`已完成“${keyword}”的候选搜索、指标补全和预评分。`);
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
      window.open(result.download_url, "_blank", "noopener,noreferrer");
      setMessage("XLSX 导出已生成。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  const currentStage = jobData ? stageLabelMap[jobData.job.stage] ?? jobData.job.stage : "未开始";
  const currentKeyword = jobData?.job.keyword ?? "未运行任务";

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
                    placeholder="输入关键词，直接跑完候选发现、补全指标和预评分..."
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
                    <input value={form.channel_country ?? ""} onChange={(event) => setFormField("channel_country", event.target.value.toUpperCase())} placeholder="留空不限，例如 PH / US / JP" maxLength={2} />
                  </label>
                  <label>
                    <span>回看天数</span>
                    <input type="number" value={form.lookback_days} onChange={(event) => setFormField("lookback_days", Number(event.target.value) || 30)} />
                  </label>
                  <label>
                    <span>最大候选数</span>
                    <input type="number" value={form.max_candidates} onChange={(event) => setFormField("max_candidates", Number(event.target.value) || 50)} />
                  </label>
                  <label>
                    <span>入围数量</span>
                    <input type="number" value={form.shortlist_size} onChange={(event) => setFormField("shortlist_size", Number(event.target.value) || 20)} />
                  </label>
                  <label>
                    <span>最小粉丝数</span>
                    <input type="number" value={form.subscriber_min} onChange={(event) => setFormField("subscriber_min", Number(event.target.value) || 3000)} />
                  </label>
                  <label>
                    <span>最大粉丝数</span>
                    <input type="number" value={form.subscriber_max} onChange={(event) => setFormField("subscriber_max", Number(event.target.value) || 50000)} />
                  </label>
                  <label>
                    <span>最低 Pre Score</span>
                    <input type="number" value={form.minimum_pre_score} onChange={(event) => setFormField("minimum_pre_score", Number(event.target.value) || 55)} />
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
              <div className="stat-value">{jobData?.results.length ?? 0}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">已入围</div>
              <div className="stat-value">{shortlistedCount}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">平均 Pre Score</div>
              <div className="stat-value">{averagePreScore?.toFixed(1) ?? "-"}</div>
            </div>
          </section>

          {message ? <div className="success-banner">{message}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}

          <section className="workspace-grid">
            <section className="workspace-panel workspace-panel--table">
              <div className="workspace-panel__header">
                <div>
                  <h2>候选结果</h2>
                  <p>按体量、表现和机会层级筛选，选择一条结果查看完整指标。</p>
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
                  <span>最低 Pre Score</span>
                  <input type="number" value={filterPreScoreMin} onChange={(event) => setFilterPreScoreMin(Number(event.target.value) || 0)} />
                </label>
                <label>
                  <span>机会层级</span>
                  <select value={filterTier} onChange={(event) => setFilterTier(event.target.value as OpportunityTier | "all")}>
                    <option value="all">全部</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                  </select>
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
                      <th><span className="table-label">国家</span></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("subscribers")}>粉丝{sortIndicator("subscribers")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("views")}>播放量{sortIndicator("views")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("engagement_rate")}>互动率<MetricHelp metric="engagement_rate" />{sortIndicator("engagement_rate")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("view_sub_ratio")}>播粉比<MetricHelp metric="view_sub_ratio" />{sortIndicator("view_sub_ratio")}</button></th>
                      <th className="centered"><button className="sort-button sort-button--accent" onClick={() => handleSort("pre_score")}>Pre Score<MetricHelp metric="pre_score" placement="top" />{sortIndicator("pre_score")}</button></th>
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
                        <td className="numeric">{formatCompactNumber(result.subscribers)}</td>
                        <td className="numeric">{formatCompactNumber(result.views)}</td>
                        <td className={`numeric ${((result.engagement_rate ?? 0) > 0.05 ? "metric-positive" : "")}`}>{formatPercent(result.engagement_rate)}</td>
                        <td className={`numeric ${((result.view_sub_ratio ?? 0) > 0.15 ? "metric-positive" : "")}`}>{formatPercent(result.view_sub_ratio)}</td>
                        <td className="centered"><span className={`score-pill ${selectedResult?.id === result.id ? "score-pill--selected" : ""}`}>{result.pre_score?.toFixed(0) ?? "-"}</span></td>
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
                        <div className="metric-card"><span>点赞数</span><strong>{formatCompactNumber(selectedResult.likes)}</strong></div>
                        <div className="metric-card"><span>评论数</span><strong>{formatCompactNumber(selectedResult.comments)}</strong></div>
                      </div>
                    </section>

                    <section className="detail-section">
                      <h4>表现指标</h4>
                      <div className="detail-list">
                        <div className="detail-list__item"><span>互动率<MetricHelp metric="engagement_rate" /></span><strong className="metric-positive">{formatPercent(selectedResult.engagement_rate)}</strong></div>
                        <div className="detail-list__item"><span>评论率<MetricHelp metric="comment_rate" /></span><strong>{formatPercent(selectedResult.comment_rate)}</strong></div>
                        <div className="detail-list__item"><span>播粉比<MetricHelp metric="view_sub_ratio" /></span><strong className="metric-positive">{formatPercent(selectedResult.view_sub_ratio)}</strong></div>
                        <div className="detail-list__item"><span>相对传播速度<MetricHelp metric="relative_velocity" /></span><strong>{selectedResult.relative_velocity?.toFixed(3) ?? "-"}</strong></div>
                      </div>
                    </section>

                    <section className="detail-section">
                      <h4>状态信息</h4>
                      <div className="detail-list">
                        <div className="detail-list__item"><span>发布时间</span><strong>{selectedResult.published_at ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>发布天数</span><strong>{selectedResult.days_since_publish ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>Pre Score<MetricHelp metric="pre_score" placement="top" /></span><strong>{selectedResult.pre_score?.toFixed(2) ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>机会层级<MetricHelp metric="opportunity_tier" /></span><strong>{selectedResult.opportunity_tier ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>国家</span><strong>{selectedResult.channel_country || "无"}</strong></div>
                        <div className="detail-list__item"><span>状态</span><strong>{statusLabelMap[selectedResult.status] ?? selectedResult.status}</strong></div>
                      </div>
                    </section>
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
