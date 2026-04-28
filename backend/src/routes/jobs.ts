import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { env } from "../config/env.js";
import type { SqliteDatabase } from "../lib/db.js";
import { stringifyJson } from "../lib/json.js";
import { nowIso } from "../lib/time.js";
import { createJobSchema } from "../schemas/jobSchemas.js";
import { runExportSchema } from "../schemas/exportSchemas.js";
import type { JobRecord } from "../types/job.js";
import type { CreatorResult } from "../types/result.js";
import type { ExportRecord } from "../types/export.js";
import {
  enrichChannelMetrics,
  enrichVideoMetrics,
  searchCandidates,
  YouTubeApiError,
  type YouTubeChannelMetric,
  type YouTubeSearchCandidate,
  type YouTubeVideoMetric
} from "../services/youtube/youtubeService.js";
import { getQuotaSummary, recordQuotaUsage } from "../services/youtube/quotaService.js";
import { computePreScore } from "../services/scoring/scoringService.js";
import { createExportFile } from "../services/export/exportService.js";
import { scrapePublicChannelContact } from "../services/playwright/contactScrapeService.js";

export interface RouteResult {
  handled: boolean;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res: ServerResponse): RouteResult {
  sendJson(res, 405, { ok: false, error: "Method not allowed" });
  return { handled: true };
}

function notFound(res: ServerResponse, message = "Not found"): RouteResult {
  sendJson(res, 404, { ok: false, error: message });
  return { handled: true };
}

function structuredError(error: unknown): Record<string, unknown> {
  if (error instanceof YouTubeApiError) {
    return {
      type: "youtube_api_error",
      message: error.message,
      status_code: error.statusCode,
      api_status: error.apiStatus
    };
  }
  return {
    type: "internal_error",
    message: error instanceof Error ? error.message : "Unknown error"
  };
}

function getJob(db: SqliteDatabase, jobId: string): JobRecord | null {
  return (
    (db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRecord | undefined) || null
  );
}

function listResultsForJob(db: SqliteDatabase, jobId: string): CreatorResult[] {
  return db.prepare("SELECT * FROM results WHERE job_id = ? ORDER BY raw_search_rank ASC").all(jobId) as unknown as CreatorResult[];
}

function listExportsForJob(db: SqliteDatabase, jobId: string): ExportRecord[] {
  return db
    .prepare("SELECT * FROM exports WHERE job_id = ? ORDER BY created_at DESC")
    .all(jobId) as unknown as ExportRecord[];
}

function runInTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function updateJobStage(db: SqliteDatabase, jobId: string, stage: JobRecord["stage"], errorMessage: string | null = null): void {
  db.prepare("UPDATE jobs SET stage = ?, error_message = ?, updated_at = ? WHERE id = ?").run(
    stage,
    errorMessage,
    nowIso(),
    jobId
  );
}

function insertJob(db: SqliteDatabase, job: JobRecord): void {
  db.prepare(
    `INSERT INTO jobs (
      id, keyword, lookback_days, subscriber_min, subscriber_max, max_candidates, shortlist_size,
      minimum_pre_score, channel_country, status, stage, config_json, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    job.id,
    job.keyword,
    job.lookback_days,
    job.subscriber_min,
    job.subscriber_max,
    job.max_candidates,
    job.shortlist_size,
    job.minimum_pre_score,
    job.channel_country ?? null,
    job.status,
    job.stage,
    job.config_json,
    job.error_message,
    job.created_at,
    job.updated_at
  );
}

function upsertSearchCandidate(db: SqliteDatabase, job: JobRecord, candidate: YouTubeSearchCandidate): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO results (
      id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
      search_source, channel_id, channel_title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)
    ON CONFLICT(job_id, video_id) DO UPDATE SET
      title = excluded.title,
      published_at = excluded.published_at,
      raw_search_rank = excluded.raw_search_rank,
      search_page = excluded.search_page,
      search_source = excluded.search_source,
      channel_id = excluded.channel_id,
      channel_title = excluded.channel_title,
      updated_at = excluded.updated_at`
  ).run(
    randomUUID(),
    job.id,
    job.keyword,
    candidate.video_id,
    candidate.video_url,
    candidate.title,
    candidate.published_at,
    candidate.raw_search_rank,
    candidate.search_page,
    candidate.search_source,
    candidate.channel_id,
    candidate.channel_title,
    timestamp,
    timestamp
  );
}

function applyVideoMetric(db: SqliteDatabase, jobId: string, metric: YouTubeVideoMetric): void {
  db.prepare(
    `UPDATE results SET
      title = COALESCE(NULLIF(?, ''), title),
      published_at = COALESCE(NULLIF(?, ''), published_at),
      views = ?,
      likes = ?,
      comments = ?,
      channel_id = COALESCE(NULLIF(?, ''), channel_id),
      channel_title = COALESCE(NULLIF(?, ''), channel_title),
      video_language = COALESCE(NULLIF(?, ''), video_language),
      status = 'enriched',
      updated_at = ?
    WHERE job_id = ? AND video_id = ?`
  ).run(
    metric.title,
    metric.published_at,
    metric.views,
    metric.likes,
    metric.comments,
    metric.channel_id,
    metric.channel_title,
    metric.video_language,
    nowIso(),
    jobId,
    metric.video_id
  );
}

function applyChannelMetric(db: SqliteDatabase, jobId: string, metric: YouTubeChannelMetric): void {
  db.prepare(
    `UPDATE results SET
      subscribers = ?,
      channel_title = COALESCE(NULLIF(?, ''), channel_title),
      channel_description = COALESCE(NULLIF(?, ''), channel_description),
      channel_avatar_url = COALESCE(NULLIF(?, ''), channel_avatar_url),
      channel_country = COALESCE(NULLIF(?, ''), channel_country),
      channel_country_source = CASE
        WHEN COALESCE(NULLIF(?, ''), '') <> '' THEN 'youtube_api'
        ELSE channel_country_source
      END,
      updated_at = ?
    WHERE job_id = ? AND channel_id = ?`
  ).run(
    metric.subscribers,
    metric.channel_title,
    metric.channel_description,
    metric.channel_avatar_url,
    metric.channel_country,
    metric.channel_country,
    nowIso(),
    jobId,
    metric.channel_id
  );
}

const PHILIPPINES_EVIDENCE_PATTERN = /\b(pinoy|filipino|philippines|philippine|tagalog)\b|菲律宾|菲律賓/i;

const COUNTRY_SOURCE_PRIORITY: Record<string, number> = {
  youtube_about_popup: 4,
  youtube_api: 3,
  metadata_keyword: 2,
  unknown: 1
};

function hasPhilippinesMetadataEvidence(row: CreatorResult): boolean {
  return PHILIPPINES_EVIDENCE_PATTERN.test([row.channel_title, row.channel_description, row.title].filter(Boolean).join(" "));
}

function countrySourcePriority(source: string | null | undefined): number {
  return COUNTRY_SOURCE_PRIORITY[source ?? ""] ?? 0;
}

function updateCountryEvidence(
  db: SqliteDatabase,
  rowId: string,
  countryCode: string,
  source: string
): void {
  db.prepare(
    `UPDATE results
     SET channel_country = ?,
         channel_country_source = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(countryCode, source, nowIso(), rowId);
}

async function strengthenCountrySignals(
  db: SqliteDatabase,
  job: JobRecord,
  rows: CreatorResult[]
): Promise<CreatorResult[]> {
  if (!job.channel_country) return rows;

  const targetCountry = job.channel_country.trim().toUpperCase();
  const resolvedRows = rows.map((row) => ({ ...row }));
  const scrapeLimit = Math.min(Math.max(job.shortlist_size * 2, 12), resolvedRows.length);

  for (let index = 0; index < scrapeLimit; index += 1) {
    const row = resolvedRows[index];
    if (!row.channel_id || !row.channel_title) continue;

    if (row.channel_country?.toUpperCase() === targetCountry && row.channel_country_source === "youtube_about_popup") {
      continue;
    }

    try {
      const channelIdentifier = row.channel_id.startsWith("UC") ? `/channel/${row.channel_id}` : `/@${row.channel_id}`;
      const scrape = await scrapePublicChannelContact({
        channelUrl: `https://www.youtube.com${channelIdentifier}`,
        requireLoggedInBrowser: false,
        manualAssist: false
      });

      if (scrape.about_page_country) {
        row.channel_country = scrape.about_page_country;
        row.channel_country_source = scrape.about_page_country_source ?? "youtube_about_popup";
        updateCountryEvidence(db, row.id, row.channel_country, row.channel_country_source);
        continue;
      }
    } catch {
      // Best-effort country enrichment; fallback to existing metadata below.
    }

    if (targetCountry === "PH" && hasPhilippinesMetadataEvidence(row)) {
      row.channel_country = "PH";
      row.channel_country_source = row.channel_country_source ?? "metadata_keyword";
      updateCountryEvidence(db, row.id, "PH", row.channel_country_source);
    } else if (row.channel_country?.toUpperCase() === targetCountry && !row.channel_country_source) {
      row.channel_country_source = "youtube_api";
      updateCountryEvidence(db, row.id, row.channel_country, "youtube_api");
    }
  }

  return resolvedRows;
}

function buildSearchKeywords(job: JobRecord): string[] {
  const normalized = job.keyword.trim();
  if (job.channel_country !== "PH") return [normalized];

  const base = normalized
    .replace(/菲律宾|菲律賓/gi, "")
    .replace(/\bphilippines\b/gi, "")
    .replace(/\bphilippine\b/gi, "")
    .replace(/\bfilipino\b/gi, "")
    .replace(/\bpinoy\b/gi, "")
    .replace(/\btagalog\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = [
    normalized,
    `${base} filipino`,
    `${base} pinoy`,
    `${base} philippines`,
    `${base} tagalog`,
    `philippines ${base}`,
    `filipino ${base}`,
    `pinoy ${base}`
  ];

  return [...new Set(candidates.map((value) => value.trim()).filter(Boolean))];
}

async function runSearch(db: SqliteDatabase, job: JobRecord): Promise<{ candidate_count: number }> {
  if (!env.YOUTUBE_API_KEY) throw new Error("Missing YOUTUBE_API_KEY");
  const searchKeywords = buildSearchKeywords(job);
  const mergedCandidates: YouTubeSearchCandidate[] = [];
  const seenVideoIds = new Set<string>();
  let totalPagesFetched = 0;
  let rawRank = 0;

  for (let index = 0; index < searchKeywords.length && mergedCandidates.length < job.max_candidates; index += 1) {
    const remaining = job.max_candidates - mergedCandidates.length;
    const searchKeyword = searchKeywords[index];
    const searchResult = await searchCandidates({
      apiKey: env.YOUTUBE_API_KEY,
      keyword: searchKeyword,
      lookbackDays: job.lookback_days,
      maxCandidates: remaining
    });

    totalPagesFetched += searchResult.pages_fetched;

    for (const candidate of searchResult.candidates) {
      if (seenVideoIds.has(candidate.video_id)) continue;
      seenVideoIds.add(candidate.video_id);
      rawRank += 1;
      mergedCandidates.push({
        ...candidate,
        raw_search_rank: rawRank
      });
      if (mergedCandidates.length >= job.max_candidates) break;
    }
  }

  runInTransaction(db, () => {
    for (const candidate of mergedCandidates) upsertSearchCandidate(db, job, candidate);
    if (totalPagesFetched > 0) {
      recordQuotaUsage(db, {
        jobId: job.id,
        actionType: "search.list",
        units: totalPagesFetched * 100,
        detail: {
          keyword: job.keyword,
          search_keywords: searchKeywords,
          pages_fetched: totalPagesFetched,
          candidate_count: mergedCandidates.length
        }
      });
    }
    updateJobStage(db, job.id, "search");
  });
  return { candidate_count: mergedCandidates.length };
}

async function runEnrichment(db: SqliteDatabase, job: JobRecord): Promise<{
  video_metric_count: number;
  channel_metric_count: number;
}> {
  if (!env.YOUTUBE_API_KEY) throw new Error("Missing YOUTUBE_API_KEY");
  const beforeRows = listResultsForJob(db, job.id);
  const videoIds = beforeRows.map((row) => row.video_id);
  const videoResult = await enrichVideoMetrics(env.YOUTUBE_API_KEY, videoIds);
  const videoMetrics = videoResult.metrics;
  const videoChannelIds = videoMetrics.map((metric) => metric.channel_id);
  const fallbackChannelIds = beforeRows.map((row) => row.channel_id || "");
  const channelIds = [...new Set([...videoChannelIds, ...fallbackChannelIds].filter(Boolean))];
  const channelResult = await enrichChannelMetrics(env.YOUTUBE_API_KEY, channelIds);
  const channelMetrics = channelResult.metrics;

  runInTransaction(db, () => {
    for (const metric of videoMetrics) applyVideoMetric(db, job.id, metric);
    for (const metric of channelMetrics) applyChannelMetric(db, job.id, metric);
    if (videoResult.requests_made > 0) {
      recordQuotaUsage(db, {
        jobId: job.id,
        actionType: "videos.list",
        units: videoResult.requests_made,
        detail: {
          requests_made: videoResult.requests_made,
          video_metric_count: videoMetrics.length
        }
      });
    }
    if (channelResult.requests_made > 0) {
      recordQuotaUsage(db, {
        jobId: job.id,
        actionType: "channels.list",
        units: channelResult.requests_made,
        detail: {
          requests_made: channelResult.requests_made,
          channel_metric_count: channelMetrics.length
        }
      });
    }
    updateJobStage(db, job.id, "enrichment");
  });

  return {
    video_metric_count: videoMetrics.length,
    channel_metric_count: channelMetrics.length
  };
}

function runPreScore(db: SqliteDatabase, job: JobRecord): { scored_count: number; skipped_count: number } {
  const rows = listResultsForJob(db, job.id);
  let scoredCount = 0;
  let skippedCount = 0;

  runInTransaction(db, () => {
    for (const row of rows) {
      if (!row.published_at) {
        skippedCount += 1;
        continue;
      }

      const score = computePreScore({
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        subscribers: row.subscribers,
        published_at: row.published_at
      });

      db.prepare(
        `UPDATE results SET
          days_since_publish = ?,
          engagement_rate = ?,
          comment_rate = ?,
          view_sub_ratio = ?,
          relative_velocity = ?,
          sub_fit_score = ?,
          view_sub_score = ?,
          engagement_score = ?,
          comment_score = ?,
          relative_velocity_score = ?,
          pre_score = ?,
          pre_score_breakdown_json = ?,
          opportunity_tier = ?,
          status = 'pre_scored',
          updated_at = ?
        WHERE id = ?`
      ).run(
        score.days_since_publish,
        score.engagement_rate,
        score.comment_rate,
        score.view_sub_ratio,
        score.relative_velocity,
        score.sub_fit_score,
        score.view_sub_score,
        score.engagement_score,
        score.comment_score,
        score.relative_velocity_score,
        score.pre_score,
        stringifyJson(score.pre_score_breakdown),
        score.opportunity_tier,
        nowIso(),
        row.id
      );
      scoredCount += 1;
    }
    updateJobStage(db, job.id, "pre_score");
  });

  return { scored_count: scoredCount, skipped_count: skippedCount };
}

async function runShortlist(db: SqliteDatabase, job: JobRecord): Promise<{ shortlisted_count: number; rejected_count: number }> {
  const hasCountryFilter = Boolean(job.channel_country);
  const countryCode = job.channel_country?.trim().toUpperCase() ?? "";
  const candidatePoolSize = Math.max(job.shortlist_size * 4, 20);
  const query = `SELECT * FROM results
      WHERE job_id = ?
        AND pre_score IS NOT NULL
        AND subscribers BETWEEN ? AND ?
        AND days_since_publish <= ?
        AND views >= 3000
        AND pre_score >= ?
      ORDER BY pre_score DESC, raw_search_rank ASC
      LIMIT ?`;

  const candidateRows = db
    .prepare(query)
    .all(
      job.id,
      job.subscriber_min,
      job.subscriber_max,
      job.lookback_days,
      job.minimum_pre_score,
      candidatePoolSize
    ) as unknown as CreatorResult[];

  const strengthenedRows = hasCountryFilter ? await strengthenCountrySignals(db, job, candidateRows) : candidateRows;
  const shortlistedRows = strengthenedRows
    .filter((row) => {
      if (!hasCountryFilter) return true;
      return row.channel_country?.trim().toUpperCase() === countryCode;
    })
    .sort((left, right) => {
      const sourceDiff = countrySourcePriority(right.channel_country_source) - countrySourcePriority(left.channel_country_source);
      if (sourceDiff !== 0) return sourceDiff;
      const scoreDiff = (right.pre_score ?? 0) - (left.pre_score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (left.raw_search_rank ?? Number.MAX_SAFE_INTEGER) - (right.raw_search_rank ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, job.shortlist_size);

  const shortlistIds = new Set(shortlistedRows.map((row) => row.id));
  const preScoredRows = db.prepare("SELECT id FROM results WHERE job_id = ? AND pre_score IS NOT NULL").all(job.id) as {
    id: string;
  }[];
  let rejectedCount = 0;

  runInTransaction(db, () => {
    for (const row of preScoredRows) {
      const status = shortlistIds.has(row.id) ? "shortlisted" : "rejected";
      if (status === "rejected") rejectedCount += 1;
      db.prepare("UPDATE results SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), row.id);
    }
    updateJobStage(db, job.id, "shortlist");
  });

  return { shortlisted_count: shortlistedRows.length, rejected_count: rejectedCount };
}

function runExport(db: SqliteDatabase, job: JobRecord, format: "csv" | "xlsx"): ExportRecord {
  const results = db
    .prepare("SELECT * FROM results WHERE job_id = ? ORDER BY pre_score DESC, raw_search_rank ASC")
    .all(job.id) as unknown as CreatorResult[];
  const timestamp = nowIso();
  const exportId = randomUUID();

  try {
    const output = createExportFile(job.id, format, results);
    const record: ExportRecord = {
      id: exportId,
      job_id: job.id,
      format,
      file_path: output.filePath,
      row_count: output.rowCount,
      status: "completed",
      error_message: null,
      created_at: timestamp
    };
    db.prepare(
      `INSERT INTO exports (id, job_id, format, file_path, row_count, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.job_id,
      record.format,
      record.file_path,
      record.row_count,
      record.status,
      record.error_message,
      record.created_at
    );
    updateJobStage(db, job.id, "export");
    return record;
  } catch (error) {
    db.prepare(
      `INSERT INTO exports (id, job_id, format, file_path, row_count, status, error_message, created_at)
       VALUES (?, ?, ?, ?, 0, 'failed', ?, ?)`
    ).run(exportId, job.id, format, "", error instanceof Error ? error.message : "Unknown export error", timestamp);
    throw error;
  }
}

function selectTargetResults(
  db: SqliteDatabase,
  jobId: string,
  resultIds: string[] | undefined,
  defaultStatuses: CreatorResult["status"][]
): CreatorResult[] {
  if (resultIds?.length) {
    const placeholders = resultIds.map(() => "?").join(",");
    return db
      .prepare(`SELECT * FROM results WHERE job_id = ? AND id IN (${placeholders}) ORDER BY pre_score DESC, raw_search_rank ASC`)
      .all(jobId, ...resultIds) as unknown as CreatorResult[];
  }

  const placeholders = defaultStatuses.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM results WHERE job_id = ? AND status IN (${placeholders}) ORDER BY pre_score DESC, raw_search_rank ASC`)
    .all(jobId, ...defaultStatuses) as unknown as CreatorResult[];
}

async function runAll(db: SqliteDatabase, job: JobRecord): Promise<Record<string, unknown>> {
  const search = await runSearch(db, job);
  const enrichment = await runEnrichment(db, job);
  const preScore = runPreScore(db, job);
  const shortlist = await runShortlist(db, job);
  return { search, enrichment, pre_score: preScore, shortlist };
}

const unimplementedStageActions = new Set<string>([]);

export async function handleJobsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  db: SqliteDatabase
): Promise<RouteResult> {
  if (pathname === "/api/jobs") {
    if (req.method !== "POST") return methodNotAllowed(res);
    const body = await readJson(req);
    const config = createJobSchema.parse(body);
    const timestamp = nowIso();
    const job: JobRecord = {
      id: randomUUID(),
      ...config,
      status: "draft",
      stage: "created",
      config_json: stringifyJson(config),
      error_message: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    insertJob(db, job);
    sendJson(res, 201, { ok: true, job });
    return { handled: true };
  }

  const match = pathname.match(/^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return { handled: false };

  const [, jobId, action] = match;
  const job = getJob(db, jobId);
  if (!job) return notFound(res, "Job not found");

  if (!action) {
    if (req.method !== "GET") return methodNotAllowed(res);
    sendJson(res, 200, {
      ok: true,
      job,
      results: listResultsForJob(db, jobId),
      exports: listExportsForJob(db, jobId)
    });
    return { handled: true };
  }

  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    if (action === "run-search") {
      const result = await runSearch(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (action === "run-enrichment") {
      const result = await runEnrichment(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (action === "run-pre-score") {
      const result = runPreScore(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (action === "run-shortlist") {
      const result = await runShortlist(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (action === "run-export") {
      const body = await readJson(req);
      const { format } = runExportSchema.parse(body);
      const result = runExport(db, job, format);
      sendJson(res, 200, {
        ok: true,
        job_id: jobId,
        action,
        export: result,
        download_url: `http://localhost:${env.PORT}/api/exports/${result.id}/download`
      });
      return { handled: true };
    }

    if (action === "run-all") {
      const result = await runAll(db, job);
      sendJson(res, 200, { ok: true, job_id: jobId, action, ...result });
      return { handled: true };
    }

    if (unimplementedStageActions.has(action)) {
      sendJson(res, 202, {
        ok: true,
        job_id: jobId,
        action,
        status: "accepted",
        message: "Stage route skeleton only; implementation is deferred to later phases."
      });
      return { handled: true };
    }
  } catch (error) {
    const errorPayload = structuredError(error);
    updateJobStage(db, jobId, "failed", String(errorPayload.message || "Unknown error"));
    sendJson(res, error instanceof YouTubeApiError ? 502 : 500, { ok: false, job_id: jobId, action, error: errorPayload });
    return { handled: true };
  }

  return { handled: false };
}
