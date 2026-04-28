import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initializeDatabase, openDatabase } from "../src/lib/db.js";
import { stringifyJson } from "../src/lib/json.js";
import { nowIso } from "../src/lib/time.js";
import { computePreScore } from "../src/services/scoring/scoringService.js";

interface InsertResultInput {
  videoId: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  subscribers: number;
  rawSearchRank: number;
}

function insertJob(db: ReturnType<typeof openDatabase>, jobId: string): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO jobs (
      id, keyword, lookback_days, subscriber_min, subscriber_max, max_candidates, shortlist_size,
      minimum_pre_score, status, stage, config_json, error_message, created_at, updated_at
    ) VALUES (?, 'phone', 30, 3000, 50000, 200, 2, 55, 'draft', 'enrichment', '{}', NULL, ?, ?)`
  ).run(jobId, timestamp, timestamp);
}

function insertScoredResult(db: ReturnType<typeof openDatabase>, jobId: string, input: InsertResultInput): void {
  const timestamp = nowIso();
  const score = computePreScore({
    views: input.views,
    likes: input.likes,
    comments: input.comments,
    subscribers: input.subscribers,
    published_at: input.publishedAt,
    now: new Date("2026-04-14T00:00:00.000Z")
  });

  db.prepare(
    `INSERT INTO results (
      id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
      search_source, views, likes, comments, subscribers, channel_id, channel_title,
      days_since_publish, engagement_rate, comment_rate, view_sub_ratio, relative_velocity,
      sub_fit_score, view_sub_score, engagement_score, comment_score, relative_velocity_score,
      pre_score, pre_score_breakdown_json, opportunity_tier, status, created_at, updated_at
    ) VALUES (?, ?, 'phone', ?, ?, ?, ?, ?, 1, 'youtube_api_search', ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pre_scored', ?, ?)`
  ).run(
    randomUUID(),
    jobId,
    input.videoId,
    `https://www.youtube.com/watch?v=${input.videoId}`,
    input.title,
    input.publishedAt,
    input.rawSearchRank,
    input.views,
    input.likes,
    input.comments,
    input.subscribers,
    `channel-${input.videoId}`,
    `Creator ${input.videoId}`,
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
    timestamp,
    timestamp
  );
}

describe("shortlist persistence rules", () => {
  it("filters by hard rules, sorts by pre_score desc, and does not favor huge channels by absolute views", () => {
    const db = openDatabase(":memory:");
    try {
      initializeDatabase(db);
      const jobId = randomUUID();
      insertJob(db, jobId);
      insertScoredResult(db, jobId, {
        videoId: "small-overperformer",
        title: "Small overperformer",
        publishedAt: "2026-04-10T00:00:00.000Z",
        views: 10000,
        likes: 500,
        comments: 100,
        subscribers: 10000,
        rawSearchRank: 2
      });
      insertScoredResult(db, jobId, {
        videoId: "huge-absolute-views",
        title: "Huge absolute views",
        publishedAt: "2026-04-10T00:00:00.000Z",
        views: 120000,
        likes: 2400,
        comments: 400,
        subscribers: 1_000_000,
        rawSearchRank: 1
      });
      insertScoredResult(db, jobId, {
        videoId: "too-old",
        title: "Too old",
        publishedAt: "2026-02-01T00:00:00.000Z",
        views: 50000,
        likes: 2000,
        comments: 500,
        subscribers: 12000,
        rawSearchRank: 3
      });
      insertScoredResult(db, jobId, {
        videoId: "too-few-views",
        title: "Too few views",
        publishedAt: "2026-04-10T00:00:00.000Z",
        views: 2000,
        likes: 100,
        comments: 30,
        subscribers: 9000,
        rawSearchRank: 4
      });

      const shortlist = db
        .prepare(
          `SELECT video_id, pre_score FROM results
           WHERE job_id = ?
             AND pre_score IS NOT NULL
             AND subscribers BETWEEN 3000 AND 50000
             AND days_since_publish <= 30
             AND views >= 3000
             AND pre_score >= 55
           ORDER BY pre_score DESC, raw_search_rank ASC
           LIMIT 2`
        )
        .all(jobId) as { video_id: string; pre_score: number }[];

      expect(shortlist.map((row) => row.video_id)).toEqual(["small-overperformer"]);
      const huge = db.prepare("SELECT pre_score, subscribers FROM results WHERE video_id = 'huge-absolute-views'").get() as {
        pre_score: number;
        subscribers: number;
      };
      expect(huge.subscribers).toBe(1_000_000);
      expect(huge.pre_score).toBeLessThan(shortlist[0].pre_score);
    } finally {
      db.close();
    }
  });
});
