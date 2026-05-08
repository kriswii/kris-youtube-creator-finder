import { randomUUID } from "node:crypto";
import path from "node:path";
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
  YouTubeApiError,
  type YouTubeChannelMetric,
  type YouTubeSearchCandidate,
  type YouTubeVideoMetric
} from "../services/youtube/youtubeService.js";
import { getQuotaSummary, recordQuotaUsage } from "../services/youtube/quotaService.js";
import { computePreScore } from "../services/scoring/scoringService.js";
import { createExportFile } from "../services/export/exportService.js";
import { scrapePublicChannelContact } from "../services/playwright/contactScrapeService.js";
import { searchCandidatesViaYouTubeWeb } from "../services/playwright/youtubeWebSearchService.js";

const FIXED_SHORTLIST_SIZE = 50;
const FIXED_LOOKBACK_DAYS = 14;
const FIXED_SUBSCRIBER_MAX = 500000;

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
      video_description = COALESCE(NULLIF(?, ''), video_description),
      video_tags_json = COALESCE(NULLIF(?, ''), video_tags_json),
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
    metric.video_description,
    stringifyJson(metric.video_tags),
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

const PHILIPPINES_LANGUAGE_PATTERN = /^(tl|fil)(-|$)|^(en)(-|$)/i;

const COUNTRY_SOURCE_PRIORITY: Record<string, number> = {
  youtube_about_popup: 4,
  youtube_api: 3,
  metadata_keyword: 2,
  language_hint: 1,
  unknown: 0
};

function hasPhilippinesMetadataEvidence(row: CreatorResult): boolean {
  return PHILIPPINES_EVIDENCE_PATTERN.test([row.channel_title, row.channel_description, row.title].filter(Boolean).join(" "));
}

function hasConflictingCountry(row: CreatorResult, targetCountry: string): boolean {
  const normalized = row.channel_country?.trim().toUpperCase();
  return Boolean(normalized && normalized !== targetCountry);
}

function hasPhilippinesLanguageEvidence(row: CreatorResult): boolean {
  return PHILIPPINES_LANGUAGE_PATTERN.test(row.video_language ?? "");
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function parseVideoTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hasKeywordInSearchSignals(row: CreatorResult, keyword: string): boolean {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) return true;

  const haystacks = [
    row.title ?? "",
    row.video_description ?? "",
    ...parseVideoTags(row.video_tags_json)
  ]
    .join(" ")
    .toLowerCase();

  return haystacks.includes(normalizedKeyword);
}

function getPhilippinesMatchLevel(row: CreatorResult): "exact" | "weak" | "none" {
  const country = row.channel_country?.trim().toUpperCase();
  if (country === "PH") return "exact";
  if (country && country !== "PH") return "none";
  if (hasPhilippinesMetadataEvidence(row)) return "weak";
  if (hasPhilippinesLanguageEvidence(row) && !hasConflictingCountry(row, "PH")) return "weak";
  return "none";
}

function countrySourcePriority(source: string | null | undefined): number {
  return COUNTRY_SOURCE_PRIORITY[source ?? ""] ?? 0;
}

function estimateChannelPriority(row: CreatorResult, targetCountry: string): number {
  const sourceScore = countrySourcePriority(row.channel_country_source) * 10000;
  const exactCountryBonus = row.channel_country?.trim().toUpperCase() === targetCountry ? 5000 : 0;
  const metadataBonus = targetCountry === "PH" && hasPhilippinesMetadataEvidence(row) ? 2500 : 0;
  const languageBonus =
    targetCountry === "PH" && hasPhilippinesLanguageEvidence(row) && !hasConflictingCountry(row, targetCountry) ? 1200 : 0;
  const viewScore = Math.min(row.views ?? 0, 1_000_000);
  const subscriberScore = Math.min(row.subscribers ?? 0, 1_000_000) / 10;
  const searchRankBonus = row.raw_search_rank ? Math.max(0, 200 - row.raw_search_rank) : 0;

  return sourceScore + exactCountryBonus + metadataBonus + languageBonus + viewScore + subscriberScore + searchRankBonus;
}

function updateCountryEvidenceForChannel(
  db: SqliteDatabase,
  jobId: string,
  channelId: string,
  countryCode: string,
  source: string
): void {
  db.prepare(
    `UPDATE results
     SET channel_country = ?,
         channel_country_source = ?,
         updated_at = ?
     WHERE job_id = ?
       AND channel_id = ?`
  ).run(countryCode, source, nowIso(), jobId, channelId);
}

async function strengthenCountrySignals(
  db: SqliteDatabase,
  job: JobRecord,
  rows: CreatorResult[]
): Promise<CreatorResult[]> {
  if (!job.channel_country) return rows;

  const targetCountry = job.channel_country.trim().toUpperCase();
  const resolvedRows = rows.map((row) => ({ ...row }));
  const channelBestRow = new Map<string, CreatorResult>();

  for (const row of resolvedRows) {
    if (!row.channel_id || !row.channel_title) continue;
    const current = channelBestRow.get(row.channel_id);
    if (!current) {
      channelBestRow.set(row.channel_id, row);
      continue;
    }

    const currentPriority = countrySourcePriority(current.channel_country_source);
    const nextPriority = countrySourcePriority(row.channel_country_source);
    if (
      nextPriority > currentPriority ||
      (nextPriority === currentPriority && (row.views ?? 0) > (current.views ?? 0)) ||
      (nextPriority === currentPriority &&
        (row.views ?? 0) === (current.views ?? 0) &&
        (row.subscribers ?? 0) > (current.subscribers ?? 0))
    ) {
      channelBestRow.set(row.channel_id, row);
    }
  }

  const uniqueChannelRows = [...channelBestRow.values()].sort(
    (left, right) => estimateChannelPriority(right, targetCountry) - estimateChannelPriority(left, targetCountry)
  );
  const scrapeLimit = Math.min(Math.max(job.shortlist_size * 2, 12), uniqueChannelRows.length);

  for (let index = 0; index < scrapeLimit; index += 1) {
    const row = uniqueChannelRows[index];
    if (!row.channel_id || !row.channel_title) continue;

    let resolvedCountry = row.channel_country?.toUpperCase() ?? null;
    let resolvedSource = row.channel_country_source ?? null;

    if (!(resolvedCountry === targetCountry && resolvedSource === "youtube_about_popup")) {
      try {
        const channelIdentifier = row.channel_id.startsWith("UC") ? `/channel/${row.channel_id}` : `/@${row.channel_id}`;
        const scrape = await scrapePublicChannelContact({
          channelUrl: `https://www.youtube.com${channelIdentifier}`,
          requireLoggedInBrowser: false,
          manualAssist: false
        });

        if (scrape.about_page_country) {
          resolvedCountry = scrape.about_page_country.toUpperCase();
          resolvedSource = scrape.about_page_country_source ?? "youtube_about_popup";
        }
      } catch {
        // Best-effort country enrichment; fallback to existing metadata below.
      }
    }

    if (targetCountry === "PH" && !resolvedCountry && !hasConflictingCountry(row, targetCountry)) {
      if (hasPhilippinesMetadataEvidence(row)) {
        resolvedCountry = "PH";
        resolvedSource = resolvedSource ?? "metadata_keyword";
      } else if (hasPhilippinesLanguageEvidence(row)) {
        resolvedCountry = "PH";
        resolvedSource = resolvedSource ?? "language_hint";
      }
    }

    if (resolvedCountry === targetCountry && !resolvedSource) {
      resolvedSource = "youtube_api";
    }

    if (resolvedCountry && resolvedSource) {
      updateCountryEvidenceForChannel(db, job.id, row.channel_id, resolvedCountry, resolvedSource);

      for (const candidate of resolvedRows) {
        if (candidate.channel_id !== row.channel_id) continue;
        candidate.channel_country = resolvedCountry;
        candidate.channel_country_source = resolvedSource;
      }
    }
  }

  return resolvedRows;
}

function buildSearchKeywords(job: JobRecord): string[] {
  return [job.keyword.trim()];
}

async function runSearch(db: SqliteDatabase, job: JobRecord): Promise<{ candidate_count: number }> {
  const searchKeywords = buildSearchKeywords(job);
  const mergedCandidates: YouTubeSearchCandidate[] = [];
  const seenVideoIds = new Set<string>();
  let totalPagesFetched = 0;
  let rawRank = 0;

  for (let index = 0; index < searchKeywords.length && mergedCandidates.length < job.max_candidates; index += 1) {
    const remaining = job.max_candidates - mergedCandidates.length;
    const searchKeyword = searchKeywords[index];
    const searchResult = await searchCandidatesViaYouTubeWeb({
      keyword: searchKeyword,
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
  const candidatePoolSize = Math.max(job.max_candidates, job.shortlist_size * 6, 30);
  const query = `SELECT * FROM results
      WHERE job_id = ?
        AND subscribers BETWEEN ? AND ?
        AND (days_since_publish IS NULL OR days_since_publish <= ?)
      ORDER BY views DESC, subscribers DESC, raw_search_rank ASC
      LIMIT ?`;

  const candidateRows = db
    .prepare(query)
    .all(
      job.id,
      job.subscriber_min,
      job.subscriber_max,
      job.lookback_days,
      candidatePoolSize
    ) as unknown as CreatorResult[];

  const strengthenedRows = hasCountryFilter ? await strengthenCountrySignals(db, job, candidateRows) : candidateRows;
  const shortlistedRows = strengthenedRows
    .filter((row) => {
      if (!hasKeywordInSearchSignals(row, job.keyword)) return false;
      if (!hasCountryFilter) return true;
      if (countryCode !== "PH") return row.channel_country?.trim().toUpperCase() === countryCode;
      return getPhilippinesMatchLevel(row) !== "none";
    })
    .sort((left, right) => {
      const sourceDiff = countrySourcePriority(right.channel_country_source) - countrySourcePriority(left.channel_country_source);
      if (sourceDiff !== 0) return sourceDiff;
      const viewDiff = (right.views ?? 0) - (left.views ?? 0);
      if (viewDiff !== 0) return viewDiff;
      const subscriberDiff = (right.subscribers ?? 0) - (left.subscribers ?? 0);
      if (subscriberDiff !== 0) return subscriberDiff;
      return (left.raw_search_rank ?? Number.MAX_SAFE_INTEGER) - (right.raw_search_rank ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, job.shortlist_size);

  const shortlistIds = new Set(shortlistedRows.map((row) => row.id));
  const candidateRowsForStatus = db.prepare("SELECT id FROM results WHERE job_id = ?").all(job.id) as {
    id: string;
  }[];
  let rejectedCount = 0;

  runInTransaction(db, () => {
    for (const row of candidateRowsForStatus) {
      const status = shortlistIds.has(row.id) ? "shortlisted" : "rejected";
      if (status === "rejected") rejectedCount += 1;
      db.prepare("UPDATE results SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), row.id);
    }
    updateJobStage(db, job.id, "shortlist");
  });

  return { shortlisted_count: shortlistedRows.length, rejected_count: rejectedCount };
}

function normalizeCountryCode(value: string | null | undefined): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return "";
  const upper = normalized.toUpperCase();
  if (["PH", "PHILIPPINES", "FILIPINO", "PINOY"].includes(upper) || ["菲律宾", "菲律賓"].includes(normalized)) {
    return "PH";
  }
  return upper;
}

function buildChannelDedupKey(row: CreatorResult): string {
  const channelId = row.channel_id?.trim();
  if (channelId) return `id:${channelId}`;
  return `title:${(row.channel_title ?? row.title ?? "").trim().toLowerCase()}`;
}

function isCountryMatchForExport(row: CreatorResult, selectedCountry: string): boolean {
  if (!selectedCountry) return true;
  if (selectedCountry === "PH") return getPhilippinesMatchLevel(row) !== "none";
  return normalizeCountryCode(row.channel_country) === selectedCountry;
}

function scoreExportRow(row: CreatorResult, selectedCountry: string): number {
  const sourceScore = countrySourcePriority(row.channel_country_source) * 1_000_000;
  const countryScore =
    !selectedCountry
      ? 0
      : selectedCountry === "PH"
        ? getPhilippinesMatchLevel(row) === "exact"
          ? 500_000
          : getPhilippinesMatchLevel(row) === "weak"
            ? 250_000
            : 0
        : normalizeCountryCode(row.channel_country) === selectedCountry
          ? 500_000
          : 0;
  const viewScore = Math.min(row.views ?? 0, 10_000_000);
  const subscriberScore = Math.min(row.subscribers ?? 0, 10_000_000) / 10;
  const searchRankScore = row.raw_search_rank ? Math.max(0, 10_000 - row.raw_search_rank) : 0;
  return sourceScore + countryScore + viewScore + subscriberScore + searchRankScore;
}

function prepareExportResults(job: JobRecord, rows: CreatorResult[]): CreatorResult[] {
  const selectedCountry = normalizeCountryCode(job.channel_country);
  const deduped = new Map<string, CreatorResult>();

  for (const row of rows) {
    if (!isCountryMatchForExport(row, selectedCountry)) continue;

    const key = buildChannelDedupKey(row);
    const current = deduped.get(key);
    if (!current || scoreExportRow(row, selectedCountry) > scoreExportRow(current, selectedCountry)) {
      deduped.set(key, row);
    }
  }

  return [...deduped.values()].sort((left, right) => scoreExportRow(right, selectedCountry) - scoreExportRow(left, selectedCountry));
}

function runExport(db: SqliteDatabase, job: JobRecord, format: "csv" | "xlsx"): ExportRecord {
  const results = db
    .prepare("SELECT * FROM results WHERE job_id = ? ORDER BY pre_score DESC, raw_search_rank ASC")
    .all(job.id) as unknown as CreatorResult[];
  const exportResults = prepareExportResults(job, results);
  const timestamp = nowIso();
  const exportId = randomUUID();

  try {
    const output = createExportFile(job.id, format, exportResults);
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
    const normalizedConfig = {
      ...config,
      lookback_days: FIXED_LOOKBACK_DAYS,
      subscriber_max: FIXED_SUBSCRIBER_MAX,
      shortlist_size: FIXED_SHORTLIST_SIZE
    };
    const timestamp = nowIso();
    const job: JobRecord = {
      id: randomUUID(),
      ...normalizedConfig,
      status: "draft",
      stage: "created",
      config_json: stringifyJson(normalizedConfig),
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
        download_url: `http://localhost:${env.PORT}/api/exports/${result.id}/download`,
        filename: path.basename(result.file_path),
        file_path: result.file_path
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
