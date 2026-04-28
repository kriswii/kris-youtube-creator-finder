import { describe, expect, it } from "vitest";
import { createJobSchema, jobStageSchema } from "../src/schemas/jobSchemas.js";
import { resultStatusSchema, creatorResultSchema } from "../src/schemas/resultSchemas.js";
import { minimaxAnalysisSchema } from "../src/schemas/minimaxSchemas.js";
import { exportRecordSchema } from "../src/schemas/exportSchemas.js";
import { contactInfoSchema } from "../src/schemas/contactSchemas.js";
import { cometSummarySchema } from "../src/schemas/cometSchemas.js";
import { scoringInputSchema } from "../src/schemas/scoringSchemas.js";
import { initializeDatabase, openDatabase } from "../src/lib/db.js";

describe("Step 2 schemas", () => {
  it("applies create job defaults and rejects empty keywords", () => {
    const parsed = createJobSchema.parse({ keyword: "iphone accessories" });
    expect(parsed.lookback_days).toBe(30);
    expect(parsed.subscriber_min).toBe(3000);
    expect(parsed.subscriber_max).toBe(50000);
    expect(parsed.max_candidates).toBe(200);
    expect(parsed.minimum_pre_score).toBe(55);
    expect(() => createJobSchema.parse({ keyword: "" })).toThrow();
  });

  it("keeps job stage and result status as limited enums", () => {
    expect(jobStageSchema.parse("pre_score")).toBe("pre_score");
    expect(() => jobStageSchema.parse("anything")).toThrow();
    expect(resultStatusSchema.parse("shortlisted")).toBe("shortlisted");
    expect(() => resultStatusSchema.parse("anything")).toThrow();
  });

  it("validates external integration record shapes without running integrations", () => {
    expect(
      minimaxAnalysisSchema.parse({
        content_type: "review",
        content_fit_score: 80,
        audience_fit_score: 75,
        brand_safety_score: 95,
        commercial_intent_score: 60,
        reason: "Good fit."
      })
    ).toMatchObject({ content_type: "review" });

    expect(
      contactInfoSchema.parse({
        public_email: null,
        social_links: ["https://www.instagram.com/example"],
        website_url: null,
        contact_status: "found",
        contactability_score: 70
      })
    ).toMatchObject({ contactability_score: 70 });

    expect(
      cometSummarySchema.parse({
        id: "comet_1",
        job_id: "job_1",
        result_id: "result_1",
        mode: "manual",
        prompt: "Summarize",
        raw_output: "VIDEO_SUMMARY:\n...",
        video_summary: "...",
        comments_summary: "...",
        audience: null,
        sentiment: null,
        brand_fit: null,
        parse_status: "parsed",
        error_message: null,
        created_at: "2026-04-14T00:00:00.000Z"
      })
    ).toMatchObject({ mode: "manual" });

    expect(
      exportRecordSchema.parse({
        id: "export_1",
        job_id: "job_1",
        format: "xlsx",
        file_path: "./data/exports/job_1.xlsx",
        row_count: 10,
        status: "completed",
        error_message: null,
        created_at: "2026-04-14T00:00:00.000Z"
      })
    ).toMatchObject({ format: "xlsx" });
  });

  it("validates result and scoring schemas", () => {
    expect(
      scoringInputSchema.parse({
        views: 10000,
        likes: 500,
        comments: 120,
        subscribers: 12000,
        published_at: "2026-04-10T00:00:00.000Z"
      })
    ).toMatchObject({ subscribers: 12000 });

    expect(
      creatorResultSchema.parse({
        id: "result_1",
        job_id: "job_1",
        keyword: "phone case",
        video_id: "abc123",
        video_url: "https://www.youtube.com/watch?v=abc123",
        title: "Review",
        published_at: "2026-04-10T00:00:00.000Z",
        raw_search_rank: 1,
        search_page: 1,
        search_source: "search.list",
        views: 10000,
        likes: 500,
        comments: 120,
        subscribers: 12000,
        channel_id: "channel_1",
        channel_title: "Creator",
        channel_avatar_url: "https://yt3.googleusercontent.com/example=s800-c-k-c0x00ffffff-no-rj",
        channel_country: "US",
        days_since_publish: 4,
        engagement_rate: 0.074,
        comment_rate: 0.012,
        view_sub_ratio: 0.833,
        relative_velocity: 0.208,
        sub_fit_score: 1,
        view_sub_score: 1,
        engagement_score: 1,
        comment_score: 1,
        relative_velocity_score: 1,
        pre_score: 100,
        pre_score_breakdown_json: "{}",
        opportunity_tier: "A",
        public_email: "creator@example.com",
        social_links_json: "[]",
        website_url: null,
        contactability_score: 100,
        contact_status: "found",
        raw_comet_output: null,
        comet_video_summary: null,
        comet_comments_summary: null,
        minimax_content_type: null,
        minimax_content_fit_score: null,
        minimax_audience_fit_score: null,
        minimax_brand_safety_score: null,
        minimax_commercial_intent_score: null,
        minimax_reason: null,
        minimax_status: null,
        minimax_error: null,
        final_score: null,
        final_score_breakdown_json: null,
        outreach_priority: null,
        status: "pre_scored",
        created_at: "2026-04-14T00:00:00.000Z",
        updated_at: "2026-04-14T00:00:00.000Z"
      })
    ).toMatchObject({ status: "pre_scored" });
  });
});

describe("SQLite schema", () => {
  it("creates required tables and indexes", () => {
    const db = openDatabase(":memory:");
    try {
      initializeDatabase(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(expect.arrayContaining(["jobs", "results", "comet_summaries", "exports"]));

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(indexes).toEqual(
        expect.arrayContaining([
          "idx_results_job_id",
          "idx_results_job_pre_score",
          "idx_results_job_final_score",
          "idx_results_job_subscribers",
          "idx_results_job_published_at"
        ])
      );
    } finally {
      db.close();
    }
  });
});
