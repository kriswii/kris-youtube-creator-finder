import {
  enrichVideoMetrics,
  searchCandidates,
  type YouTubeFetch,
  type YouTubeSearchCandidate,
  type YouTubeVideoMetric
} from "../youtube/youtubeService.js";
import type { RobloxContentSignal, RobloxSignalKind } from "../../types/socialTopic.js";

export const DEFAULT_ROBLOX_YOUTUBE_QUERIES = [
  "roblox trending games tips -codes -code -robux",
  "roblox popular game guide -codes -code -robux",
  "roblox funny moments meme -codes -code -robux",
  "roblox secrets beginner tips -codes -code -robux",
  "roblox new update guide -codes -code -robux"
];

const CODE_PATTERNS = [
  /\bcode\b/i,
  /\bcodes\b/i,
  /\bredeem\b/i,
  /\bpromo\b/i,
  /\bfree\s+robux\b/i,
  /\brobux\s+generator\b/i,
  /\bgift\s*card\b/i
];

const LOW_TOPIC_VALUE_PATTERNS = [
  /#shorts?\b/i,
  /\bshorts?\b/i,
  /\bpov[:\s]/i,
  /\bchallenge\b/i,
  /\bchallange\b/i,
  /\bhelp\s+us\s+decide\b/i,
  /\bwallahi\b/i,
  /\bfinally\s+have\b/i
];

const HIGH_TOPIC_VALUE_PATTERNS = [
  /\bhow to\b/i,
  /\btips?\b/i,
  /\bguide\b/i,
  /\btop\s+\d+\b/i,
  /\bbest\b/i,
  /\bsecret\b/i,
  /\bhidden\b/i,
  /\bupdate\b/i,
  /\bbeginner\b/i,
  /\baccessor(?:y|ies)\b/i,
  /\bswords?\b/i,
  /\bstats?\b/i
];

const KNOWN_GAMES = [
  "Grow a Garden",
  "Blox Fruits",
  "Dress To Impress",
  "Brookhaven",
  "Adopt Me",
  "Blade Ball",
  "Pet Simulator",
  "Fisch",
  "Blue Lock Rivals",
  "Anime Vanguards",
  "Murder Mystery 2",
  "Toilet Tower Defense",
  "Doors",
  "BedWars",
  "The Strongest Battlegrounds"
];

export interface YouTubeRobloxCollectionInput {
  apiKey: string;
  queries?: string[];
  lookbackDays?: number;
  maxPerQuery?: number;
  maxSignals?: number;
  now?: Date;
  fetchImpl?: YouTubeFetch;
}

function hasCodeIntent(text: string): boolean {
  return CODE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasLowTopicValue(text: string): boolean {
  return LOW_TOPIC_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasHighTopicValue(text: string): boolean {
  return HIGH_TOPIC_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

function detectKind(title: string): RobloxSignalKind {
  const lower = title.toLowerCase();
  if (/\b(fun(?:ny)?|meme|moments|troll|fail|rage|noob|friend)\b/.test(lower)) return "meme";
  if (/\b(how to|guide|tips?|secret|beginner|best|update|hidden|tutorial|strategy)\b/.test(lower)) {
    return "guide_question";
  }
  return "game_trend";
}

function detectGame(title: string): string | undefined {
  const normalized = title.toLowerCase();
  return KNOWN_GAMES.find((game) => normalized.includes(game.toLowerCase()));
}

function engagementScore(metric: YouTubeVideoMetric): number {
  const title = metric.title || "";
  const qualityMultiplier = hasHighTopicValue(title) ? 1.25 : 1;
  return Math.round((metric.views + metric.likes * 5 + metric.comments * 20) * qualityMultiplier);
}

function reliabilityFor(metric: YouTubeVideoMetric, candidate?: YouTubeSearchCandidate): number {
  const titleScore = metric.title || candidate?.title ? 10 : 0;
  const channelScore = metric.channel_title || candidate?.channel_title ? 10 : 0;
  const engagementTrust = metric.views >= 100_000 ? 15 : metric.views >= 25_000 ? 10 : metric.views >= 5_000 ? 5 : 0;
  return Math.min(85, 50 + titleScore + channelScore + engagementTrust);
}

function businessFitFor(kind: RobloxSignalKind, title: string): number {
  const lower = title.toLowerCase();
  if (kind === "guide_question") return lower.includes("beginner") || lower.includes("tips") ? 86 : 78;
  if (kind === "game_trend") return 76;
  if (kind === "meme") return 62;
  return 55;
}

function interactionFor(kind: RobloxSignalKind, metric: YouTubeVideoMetric): number {
  const base = kind === "meme" ? 90 : kind === "guide_question" ? 78 : 70;
  const commentBoost = metric.comments >= 500 ? 8 : metric.comments >= 100 ? 5 : metric.comments >= 20 ? 2 : 0;
  return Math.min(100, base + commentBoost);
}

function tagsFor(kind: RobloxSignalKind, title: string, game?: string): string[] {
  const tags = ["roblox", kind.replace("_", "-")];
  if (game) tags.push(game.toLowerCase().replace(/\s+/g, "-"));
  if (title.toLowerCase().includes("beginner")) tags.push("beginner");
  if (title.toLowerCase().includes("update")) tags.push("update");
  return tags;
}

function videoToSignal(
  metric: YouTubeVideoMetric,
  rank: number,
  candidate?: YouTubeSearchCandidate
): RobloxContentSignal | null {
  const title = metric.title || candidate?.title || "";
  if (!title || hasCodeIntent(title)) return null;
  if (hasLowTopicValue(title) && !hasHighTopicValue(title)) return null;

  const kind = detectKind(title);
  const game = detectGame(title);

  return {
    id: `yt-${metric.video_id}`,
    kind,
    source_type: "creator",
    title,
    game,
    source_url: `https://www.youtube.com/watch?v=${metric.video_id}`,
    observed_at: metric.published_at || candidate?.published_at || new Date().toISOString(),
    engagement_count: Math.max(0, engagementScore(metric) - rank),
    business_fit: businessFitFor(kind, title),
    interaction_potential: interactionFor(kind, metric),
    reliability: reliabilityFor(metric, candidate),
    tags: tagsFor(kind, title, game),
    risk_flags: [],
    notes: `YouTube views=${metric.views}; likes=${metric.likes}; comments=${metric.comments}; channel=${metric.channel_title || candidate?.channel_title || "unknown"}`
  };
}

export async function collectYouTubeRobloxSignals(
  input: YouTubeRobloxCollectionInput
): Promise<RobloxContentSignal[]> {
  const queries = input.queries?.length ? input.queries : DEFAULT_ROBLOX_YOUTUBE_QUERIES;
  const lookbackDays = input.lookbackDays ?? 7;
  const maxPerQuery = input.maxPerQuery ?? 8;
  const maxSignals = input.maxSignals ?? 20;
  const candidateByVideoId = new Map<string, YouTubeSearchCandidate>();

  for (const query of queries) {
    const searchResult = await searchCandidates({
      apiKey: input.apiKey,
      keyword: query,
      lookbackDays,
      maxCandidates: maxPerQuery,
      maxPages: 1,
      now: input.now,
      fetchImpl: input.fetchImpl
    });

    for (const candidate of searchResult.candidates) {
      if (hasCodeIntent(candidate.title)) continue;
      if (!candidateByVideoId.has(candidate.video_id)) candidateByVideoId.set(candidate.video_id, candidate);
    }
  }

  const videoIds = [...candidateByVideoId.keys()];
  const videoResult = await enrichVideoMetrics(input.apiKey, videoIds, input.fetchImpl);

  return videoResult.metrics
    .map((metric, index) => videoToSignal(metric, index, candidateByVideoId.get(metric.video_id)))
    .filter((signal): signal is RobloxContentSignal => Boolean(signal))
    .filter((signal) => signal.kind !== "redeem_code")
    .sort((a, b) => b.engagement_count - a.engagement_count || a.id.localeCompare(b.id))
    .slice(0, maxSignals);
}
