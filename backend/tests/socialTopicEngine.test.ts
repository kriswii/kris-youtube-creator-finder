import { describe, expect, it } from "vitest";
import type { RobloxContentSignal } from "../src/types/socialTopic.js";
import { buildRobloxTopicReport } from "../src/services/social/robloxTopicEngine.js";

const now = new Date("2026-04-16T09:00:00.000Z");

function signal(overrides: Partial<RobloxContentSignal>): RobloxContentSignal {
  return {
    id: "base",
    kind: "game_trend",
    source_type: "search_trend",
    title: "Roblox players are asking for beginner tips.",
    game: "Roblox",
    observed_at: "2026-04-16T08:00:00.000Z",
    engagement_count: 1000,
    business_fit: 80,
    interaction_potential: 80,
    reliability: 80,
    tags: ["roblox"],
    risk_flags: [],
    ...overrides
  };
}

describe("roblox topic engine", () => {
  it("ranks high demand, relevant, fresh, trusted topics as publishable", () => {
    const report = buildRobloxTopicReport({
      brand: "Test",
      audience: "Players",
      now,
      signals: [
        signal({ id: "low", engagement_count: 50, business_fit: 40, reliability: 50 }),
        signal({ id: "high", engagement_count: 1000, business_fit: 90, reliability: 90 })
      ]
    });

    expect(report.top_pick?.id).toBe("high");
    expect(report.top_pick?.action).toBe("publish");
    expect(report.top_pick?.score).toBeGreaterThanOrEqual(75);
  });

  it("penalizes unverified code topics and requires review", () => {
    const report = buildRobloxTopicReport({
      brand: "Test",
      audience: "Players",
      now,
      signals: [
        signal({
          id: "code",
          kind: "redeem_code",
          title: "Players are checking new game codes.",
          engagement_count: 1000,
          business_fit: 90,
          reliability: 80,
          risk_flags: ["unverified_code"]
        })
      ]
    });

    expect(report.top_pick?.risk_level).toBe("medium");
    expect(report.top_pick?.action).toBe("review");
    expect(report.top_pick?.score).toBeLessThan(75);
  });

  it("skips free Robux claims even when engagement is high", () => {
    const report = buildRobloxTopicReport({
      brand: "Test",
      audience: "Players",
      now,
      signals: [
        signal({
          id: "unsafe",
          title: "Free Robux generator claim is trending.",
          engagement_count: 100000,
          business_fit: 95,
          interaction_potential: 100,
          reliability: 5,
          risk_flags: ["free_robux_claim"]
        })
      ]
    });

    expect(report.top_pick?.action).toBe("skip");
    expect(report.top_pick?.risk_level).toBe("high");
    expect(report.top_pick?.score).toBe(0);
  });

  it("uses deterministic tie ordering by id", () => {
    const report = buildRobloxTopicReport({
      brand: "Test",
      audience: "Players",
      now,
      signals: [signal({ id: "b" }), signal({ id: "a" })]
    });

    expect(report.candidates.map((candidate) => candidate.id)).toEqual(["a", "b"]);
  });

  it("turns a ranked YouTube-style topic into a Facebook-ready discussion post", () => {
    const report = buildRobloxTopicReport({
      brand: "Test",
      audience: "Players",
      now,
      signals: [
        signal({
          id: "top-races",
          title: 'TOP 3 "Races" In Sailor Piece #roblox #sailorpiece',
          game: "Sailor Piece",
          kind: "guide_question"
        })
      ]
    });

    expect(report.top_pick?.draft.facebook_text).toContain("Sailor Piece players, settle this one.");
    expect(report.top_pick?.draft.facebook_text).toContain("Drop your pick in the comments.");
    expect(report.top_pick?.draft.image_prompt).toContain("top 3 races players are comparing");
    expect(report.top_pick?.draft.facebook_text).not.toContain("#roblox");
  });
});
