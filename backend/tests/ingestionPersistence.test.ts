import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { initializeDatabase, openDatabase } from "../src/lib/db.js";
import { nowIso } from "../src/lib/time.js";

describe("ingestion persistence", () => {
  it("upserts candidates and repeated enrichment updates rows without duplicates", () => {
    const db = openDatabase(":memory:");
    try {
      initializeDatabase(db);
      const jobId = randomUUID();
      const timestamp = nowIso();
      db.prepare(
        `INSERT INTO jobs (
          id, keyword, lookback_days, subscriber_min, subscriber_max, max_candidates, shortlist_size,
          minimum_pre_score, status, stage, config_json, error_message, created_at, updated_at
        ) VALUES (?, 'phone', 30, 3000, 50000, 200, 50, 55, 'draft', 'created', '{}', NULL, ?, ?)`
      ).run(jobId, timestamp, timestamp);

      const insertCandidate = db.prepare(
        `INSERT INTO results (
          id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
          search_source, channel_id, channel_title, status, created_at, updated_at
        ) VALUES (?, ?, 'phone', 'v1', 'https://www.youtube.com/watch?v=v1', 'Snippet', '2026-04-10T00:00:00.000Z', 1, 1,
          'youtube_api_search', 'c1', 'Creator', 'candidate', ?, ?)
        ON CONFLICT(job_id, video_id) DO UPDATE SET
          title = excluded.title,
          updated_at = excluded.updated_at`
      );

      insertCandidate.run(randomUUID(), jobId, timestamp, timestamp);
      insertCandidate.run(randomUUID(), jobId, timestamp, timestamp);

      const countAfterSearch = db.prepare("SELECT COUNT(*) AS count FROM results WHERE job_id = ?").get(jobId) as {
        count: number;
      };
      expect(countAfterSearch.count).toBe(1);

      const updateMetric = db.prepare(
        `UPDATE results SET views = ?, likes = ?, comments = ?, subscribers = ?, status = 'enriched', updated_at = ?
         WHERE job_id = ? AND video_id = 'v1'`
      );
      updateMetric.run(10000, 500, 120, 12000, timestamp, jobId);
      updateMetric.run(12000, 600, 150, 13000, timestamp, jobId);

      const row = db.prepare("SELECT views, likes, comments, subscribers, status FROM results WHERE job_id = ?").get(jobId) as {
        views: number;
        likes: number;
        comments: number;
        subscribers: number;
        status: string;
      };
      expect(row).toMatchObject({ views: 12000, likes: 600, comments: 150, subscribers: 13000, status: "enriched" });
    } finally {
      db.close();
    }
  });
});
