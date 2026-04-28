import { describe, expect, it } from "vitest";
import {
  clamp,
  computeContactabilityScore,
  computeCommentRate,
  computeDaysSincePublish,
  computeEngagementRate,
  computeFinalScore,
  computeOpportunityTier,
  computePreScore,
  computeSubscriberFitScore,
  computeViewSubRatio
} from "../src/services/scoring/scoringService.js";

describe("scoring service", () => {
  it("computes derived metrics and pre_score with the fixed formula", () => {
    const score = computePreScore({
      views: 4000,
      likes: 100,
      comments: 50,
      subscribers: 10000,
      published_at: "2026-04-10T00:00:00.000Z",
      now: new Date("2026-04-14T00:00:00.000Z")
    });

    expect(score.days_since_publish).toBe(4);
    expect(score.engagement_rate).toBe(0.05);
    expect(score.comment_rate).toBe(0.0125);
    expect(score.view_sub_ratio).toBe(0.4);
    expect(score.relative_velocity).toBe(0.1);
    expect(score.sub_fit_score).toBe(1);
    expect(score.view_sub_score).toBe(1);
    expect(score.engagement_score).toBe(1);
    expect(score.comment_score).toBe(1);
    expect(score.relative_velocity_score).toBe(1);
    expect(score.pre_score).toBe(100);
    expect(score.opportunity_tier).toBe("A");
  });

  it("caps normalized component scores at 1", () => {
    expect(clamp(10, 0, 1)).toBe(1);
    expect(computeViewSubRatio(100000, 10000) / 0.4).toBeGreaterThan(1);

    const score = computePreScore({
      views: 100000,
      likes: 10000,
      comments: 1000,
      subscribers: 10000,
      published_at: "2026-04-13T00:00:00.000Z",
      now: new Date("2026-04-14T00:00:00.000Z")
    });

    expect(score.view_sub_score).toBe(1);
    expect(score.engagement_score).toBe(1);
    expect(score.comment_score).toBe(1);
    expect(score.relative_velocity_score).toBe(1);
  });

  it("maps subscriber fit boundaries exactly", () => {
    expect(computeSubscriberFitScore(2999)).toBe(0);
    expect(computeSubscriberFitScore(3000)).toBe(0.7);
    expect(computeSubscriberFitScore(7999)).toBe(0.7);
    expect(computeSubscriberFitScore(8000)).toBe(1);
    expect(computeSubscriberFitScore(30000)).toBe(1);
    expect(computeSubscriberFitScore(30001)).toBe(0.8);
    expect(computeSubscriberFitScore(50000)).toBe(0.8);
    expect(computeSubscriberFitScore(50001)).toBe(0.5);
    expect(computeSubscriberFitScore(100000)).toBe(0.5);
    expect(computeSubscriberFitScore(100001)).toBe(0);
  });

  it("maps opportunity tiers exactly", () => {
    expect(computeOpportunityTier(85)).toBe("A");
    expect(computeOpportunityTier(84.99)).toBe("B");
    expect(computeOpportunityTier(70)).toBe("B");
    expect(computeOpportunityTier(69.99)).toBe("C");
    expect(computeOpportunityTier(55)).toBe("C");
    expect(computeOpportunityTier(54.99)).toBe("D");
  });

  it("uses max denominators for zero views/subscribers and at least one publish day", () => {
    expect(computeEngagementRate(10, 5, 0)).toBe(20);
    expect(computeCommentRate(5, 0)).toBe(5);
    expect(computeViewSubRatio(100, 0)).toBe(100);
    expect(computeDaysSincePublish("2026-04-14T12:00:00.000Z", new Date("2026-04-14T00:00:00.000Z"))).toBe(1);
  });

  it("does not let a huge creator win just because absolute views are higher", () => {
    const smallCreator = computePreScore({
      views: 10000,
      likes: 500,
      comments: 100,
      subscribers: 10000,
      published_at: "2026-04-10T00:00:00.000Z",
      now: new Date("2026-04-14T00:00:00.000Z")
    });
    const hugeCreator = computePreScore({
      views: 120000,
      likes: 2400,
      comments: 400,
      subscribers: 1_000_000,
      published_at: "2026-04-10T00:00:00.000Z",
      now: new Date("2026-04-14T00:00:00.000Z")
    });

    expect(smallCreator.pre_score).toBeGreaterThan(hugeCreator.pre_score);
    expect(smallCreator.sub_fit_score).toBe(1);
    expect(hugeCreator.sub_fit_score).toBe(0);
  });

  it("computes backend-owned final_score formula for later phases", () => {
    const score = computeFinalScore({
      pre_score: 80,
      contactability_score: 100,
      content_fit_score: 70,
      audience_fit_score: 60,
      brand_safety_score: 90
    });

    expect(score.final_score).toBeCloseTo(81);
    expect(score.outreach_priority).toBe("P2");
  });

  it("maps contactability exactly by public signals", () => {
    expect(
      computeContactabilityScore({
        publicEmailFound: true,
        socialLinksFound: true,
        websiteOrContactPageFound: true
      })
    ).toBe(100);
    expect(
      computeContactabilityScore({
        publicEmailFound: false,
        socialLinksFound: true,
        websiteOrContactPageFound: true
      })
    ).toBe(70);
    expect(
      computeContactabilityScore({
        publicEmailFound: false,
        socialLinksFound: false,
        websiteOrContactPageFound: true
      })
    ).toBe(50);
    expect(
      computeContactabilityScore({
        publicEmailFound: false,
        socialLinksFound: false,
        websiteOrContactPageFound: false
      })
    ).toBe(0);
  });
});
