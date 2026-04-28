import type { RobloxContentSignal } from "../../types/socialTopic.js";

export function buildSeedRobloxSignals(now = new Date()): RobloxContentSignal[] {
  const isoHoursAgo = (hours: number): string => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

  return [
    {
      id: "seed-grow-garden-trend",
      kind: "game_trend",
      source_type: "search_trend",
      title: "Players are looking for fast beginner progress routes and rare-item tips.",
      game: "Grow a Garden",
      observed_at: isoHoursAgo(4),
      engagement_count: 9200,
      business_fit: 85,
      interaction_potential: 80,
      reliability: 72,
      tags: ["roblox", "tips", "beginner", "popular-game"],
      risk_flags: []
    },
    {
      id: "seed-blox-fruits-codes",
      kind: "redeem_code",
      source_type: "community",
      title: "Blox Fruits players are checking which boost codes still work.",
      game: "Blox Fruits",
      observed_at: isoHoursAgo(8),
      engagement_count: 8100,
      business_fit: 75,
      interaction_potential: 88,
      reliability: 58,
      tags: ["roblox", "codes", "blox-fruits"],
      risk_flags: ["unverified_code"],
      notes: "Needs official or wiki source check before publishing."
    },
    {
      id: "seed-dti-meme",
      kind: "meme",
      source_type: "community",
      title: "That moment when the theme is simple but everyone arrives dressed like a final boss.",
      game: "Dress To Impress",
      observed_at: isoHoursAgo(3),
      engagement_count: 6400,
      business_fit: 62,
      interaction_potential: 92,
      reliability: 80,
      tags: ["roblox", "meme", "fashion"],
      risk_flags: []
    },
    {
      id: "seed-brookhaven-guide",
      kind: "guide_question",
      source_type: "creator",
      title: "Best secret locations newer Brookhaven players usually miss.",
      game: "Brookhaven",
      observed_at: isoHoursAgo(18),
      engagement_count: 5100,
      business_fit: 65,
      interaction_potential: 70,
      reliability: 76,
      tags: ["roblox", "guide", "brookhaven"],
      risk_flags: []
    },
    {
      id: "seed-trade-safety",
      kind: "safety",
      source_type: "internal",
      title: "Before trading or buying items, verify the seller, price, and delivery path.",
      observed_at: isoHoursAgo(2),
      engagement_count: 2100,
      business_fit: 90,
      interaction_potential: 50,
      reliability: 95,
      tags: ["roblox", "safety", "buying"],
      risk_flags: []
    },
    {
      id: "seed-free-robux-skip",
      kind: "commerce",
      source_type: "community",
      title: "Free Robux generator claim is circulating again.",
      observed_at: isoHoursAgo(1),
      engagement_count: 12000,
      business_fit: 20,
      interaction_potential: 95,
      reliability: 5,
      tags: ["roblox", "unsafe"],
      risk_flags: ["free_robux_claim"]
    }
  ];
}
