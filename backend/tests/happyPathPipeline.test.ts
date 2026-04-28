import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initializeDatabase, openDatabase } from "../src/lib/db.js";
import { nowIso } from "../src/lib/time.js";
import { stringifyJson } from "../src/lib/json.js";
import { computeContactabilityScore, computeFinalScore, computePreScore } from "../src/services/scoring/scoringService.js";
import { buildCometRecord } from "../src/services/comet/cometService.js";
import { requestMiniMaxAnalysis } from "../src/services/minimax/minimaxService.js";

describe("happy path pipeline", () => {
  it("flows from shortlisted result to analyzed result with final_score", async () => {
    const db = openDatabase(":memory:");
    try {
      initializeDatabase(db);
      const jobId = randomUUID();
      const resultId = randomUUID();
      const timestamp = nowIso();

      db.prepare(
        `INSERT INTO jobs (
          id, keyword, lookback_days, subscriber_min, subscriber_max, max_candidates, shortlist_size,
          minimum_pre_score, status, stage, config_json, error_message, created_at, updated_at
        ) VALUES (?, 'phone review', 30, 3000, 50000, 100, 20, 55, 'draft', 'shortlist', '{}', NULL, ?, ?)`
      ).run(jobId, timestamp, timestamp);

      const pre = computePreScore({
        views: 10000,
        likes: 400,
        comments: 80,
        subscribers: 10000,
        published_at: "2026-04-18T00:00:00.000Z",
        now: new Date("2026-04-21T00:00:00.000Z")
      });

      db.prepare(
        `INSERT INTO results (
          id, job_id, keyword, video_id, video_url, title, published_at, raw_search_rank, search_page,
          search_source, views, likes, comments, subscribers, channel_id, channel_title,
          days_since_publish, engagement_rate, comment_rate, view_sub_ratio, relative_velocity,
          sub_fit_score, view_sub_score, engagement_score, comment_score, relative_velocity_score,
          pre_score, pre_score_breakdown_json, opportunity_tier, status, created_at, updated_at
        ) VALUES (?, ?, 'phone review', 'abc123', 'https://www.youtube.com/watch?v=abc123', 'Phone review', '2026-04-18T00:00:00.000Z',
          1, 1, 'youtube_api_search', 10000, 400, 80, 10000, 'channel-1', 'Creator One',
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shortlisted', ?, ?)`
      ).run(
        resultId,
        jobId,
        pre.days_since_publish,
        pre.engagement_rate,
        pre.comment_rate,
        pre.view_sub_ratio,
        pre.relative_velocity,
        pre.sub_fit_score,
        pre.view_sub_score,
        pre.engagement_score,
        pre.comment_score,
        pre.relative_velocity_score,
        pre.pre_score,
        stringifyJson(pre.pre_score_breakdown),
        pre.opportunity_tier,
        timestamp,
        timestamp
      );

      const contactability = computeContactabilityScore({
        publicEmailFound: true,
        socialLinksFound: true,
        websiteOrContactPageFound: true
      });
      db.prepare(
        `UPDATE results SET public_email = 'creator@example.com', social_links_json = '["https://instagram.com/creator"]',
          website_url = 'https://creator.example', contactability_score = ?, contact_status = 'found', status = 'contacted'
         WHERE id = ?`
      ).run(contactability, resultId);

      const comet = buildCometRecord({
        id: randomUUID(),
        job_id: jobId,
        result_id: resultId,
        mode: "manual",
        raw_output: `VIDEO_SUMMARY:
The creator compares two flagship phones after one month of daily use.

COMMENTS_SUMMARY:
Viewers ask about battery life, camera sharpness, and upgrade value.

AUDIENCE:
Mobile enthusiasts deciding between flagship devices.

SENTIMENT:
Mostly positive, with debate around pricing.

BRAND_FIT:
Good fit for mobile accessories and performance-focused products.`,
        created_at: timestamp
      });
      db.prepare(
        `INSERT INTO comet_summaries (
          id, job_id, result_id, mode, prompt, raw_output, video_summary, comments_summary,
          audience, sentiment, brand_fit, parse_status, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        comet.id,
        comet.job_id,
        comet.result_id,
        comet.mode,
        comet.prompt,
        comet.raw_output,
        comet.video_summary,
        comet.comments_summary,
        comet.audience,
        comet.sentiment,
        comet.brand_fit,
        comet.parse_status,
        comet.error_message,
        comet.created_at
      );
      db.prepare(
        `UPDATE results SET raw_comet_output = ?, comet_video_summary = ?, comet_comments_summary = ?, status = 'summarized' WHERE id = ?`
      ).run(comet.raw_output, comet.video_summary, comet.comments_summary, resultId);

      const minimax = await requestMiniMaxAnalysis(
        {
          title: "Phone review",
          channel_title: "Creator One",
          views: 10000,
          likes: 400,
          comments: 80,
          subscribers: 10000,
          pre_score: pre.pre_score,
          public_email_found: true,
          social_links: ["https://instagram.com/creator"],
          comet_video_summary: comet.video_summary,
          comet_comments_summary: comet.comments_summary
        },
        {
          apiKey: "test-key",
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      content_type: "tech_review",
                      content_fit_score: 84,
                      audience_fit_score: 79,
                      brand_safety_score: 95,
                      commercial_intent_score: 67,
                      reason: "Strong creator fit for device accessories."
                    })
                  }
                ]
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
        }
      );

      const final = computeFinalScore({
        pre_score: pre.pre_score,
        contactability_score: contactability,
        content_fit_score: minimax.analysis.content_fit_score,
        audience_fit_score: minimax.analysis.audience_fit_score,
        brand_safety_score: minimax.analysis.brand_safety_score
      });
      db.prepare(
        `UPDATE results SET
          minimax_content_type = ?, minimax_content_fit_score = ?, minimax_audience_fit_score = ?,
          minimax_brand_safety_score = ?, minimax_commercial_intent_score = ?, minimax_reason = ?,
          minimax_status = 'completed', final_score = ?, final_score_breakdown_json = ?, outreach_priority = ?,
          status = 'analyzed'
         WHERE id = ?`
      ).run(
        minimax.analysis.content_type,
        minimax.analysis.content_fit_score,
        minimax.analysis.audience_fit_score,
        minimax.analysis.brand_safety_score,
        minimax.analysis.commercial_intent_score,
        minimax.analysis.reason,
        final.final_score,
        stringifyJson(final.final_score_breakdown),
        final.outreach_priority,
        resultId
      );

      const row = db.prepare("SELECT status, contact_status, minimax_status, final_score, outreach_priority FROM results WHERE id = ?").get(
        resultId
      ) as {
        status: string;
        contact_status: string;
        minimax_status: string;
        final_score: number;
        outreach_priority: string;
      };

      expect(row.status).toBe("analyzed");
      expect(row.contact_status).toBe("found");
      expect(row.minimax_status).toBe("completed");
      expect(row.final_score).toBeGreaterThan(80);
      expect(row.outreach_priority).toBe("P1");
    } finally {
      db.close();
    }
  });
});
