import { describe, expect, it } from "vitest";
import { COMET_PROMPT, buildCometRecord, parseCometRawOutput } from "../src/services/comet/cometService.js";

describe("comet service", () => {
  it("parses fixed-format Comet output", () => {
    const raw = `VIDEO_SUMMARY:
This video compares two flagship phones after one month of use.

COMMENTS_SUMMARY:
Viewers debate battery life, cameras, and whether the upgrade is worth it.

AUDIENCE:
Phone enthusiasts deciding between iPhone and Samsung.

SENTIMENT:
Mostly positive, with some disagreement on value.

BRAND_FIT:
Good fit for consumer electronics and accessories.`;

    const parsed = parseCometRawOutput(raw);
    expect(parsed.parse_status).toBe("parsed");
    expect(parsed.video_summary).toContain("compares two flagship phones");
    expect(parsed.comments_summary).toContain("battery life");
    expect(parsed.brand_fit).toContain("consumer electronics");
  });

  it("marks malformed output as failed and preserves the fixed prompt in records", () => {
    const record = buildCometRecord({
      id: "comet-1",
      job_id: "job-1",
      result_id: "result-1",
      mode: "manual",
      raw_output: "just some text",
      created_at: "2026-04-21T00:00:00.000Z"
    });

    expect(record.prompt).toBe(COMET_PROMPT);
    expect(record.parse_status).toBe("failed");
    expect(record.error_message).toContain("required format");
  });
});
