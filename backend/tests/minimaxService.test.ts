import { describe, expect, it } from "vitest";
import { parseMiniMaxJson, requestMiniMaxAnalysis } from "../src/services/minimax/minimaxService.js";

describe("minimax service", () => {
  it("parses JSON even when wrapped in markdown fences", () => {
    const parsed = parseMiniMaxJson(`\`\`\`json
{
  "content_type": "review",
  "content_fit_score": 78,
  "audience_fit_score": 73,
  "brand_safety_score": 92,
  "commercial_intent_score": 65,
  "reason": "Good fit"
}
\`\`\``);

    expect(parsed.content_type).toBe("review");
    expect(parsed.brand_safety_score).toBe(92);
  });

  it("retries once when the first response is invalid JSON", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      const content =
        calls === 1
          ? "not json"
          : JSON.stringify({
              content_type: "review",
              content_fit_score: 80,
              audience_fit_score: 75,
              brand_safety_score: 90,
              commercial_intent_score: 60,
              reason: "Good fit"
            });

      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: content }]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    };

    const result = await requestMiniMaxAnalysis(
      {
        title: "Phone review",
        channel_title: "Creator",
        views: 10000,
        likes: 300,
        comments: 20,
        subscribers: 9000,
        pre_score: 88,
        public_email_found: true,
        social_links: ["https://instagram.com/example"],
        comet_video_summary: "A phone review.",
        comet_comments_summary: "People ask about battery life."
      },
      {
        apiKey: "test-key",
        fetchImpl
      }
    );

    expect(result.analysis.content_type).toBe("review");
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
  });

  it("auto-normalizes a consistent 0-10 score payload to 0-100", () => {
    const parsed = parseMiniMaxJson(
      JSON.stringify({
        content_type: "Tech/Product Review",
        content_fit_score: 5,
        audience_fit_score: 5,
        brand_safety_score: 9,
        commercial_intent_score: 8,
        reason: "Scaled like a 0-10 rubric."
      })
    );

    expect(parsed.content_fit_score).toBe(50);
    expect(parsed.audience_fit_score).toBe(50);
    expect(parsed.brand_safety_score).toBe(90);
    expect(parsed.commercial_intent_score).toBe(80);
  });
});
