import type {
  RobloxContentSignal,
  RobloxTopicCandidate,
  TodayTopicReport,
  TopicAction,
  TopicRiskFlag
} from "../../types/socialTopic.js";

const MS_PER_HOUR = 60 * 60 * 1000;

const HARD_SKIP_FLAGS: TopicRiskFlag[] = [
  "free_robux_claim",
  "account_trading",
  "off_platform_currency_sale",
  "minor_targeting"
];

export const ROBLOX_CONTENT_GUARDRAILS = [
  "Do not promise free Robux or guaranteed working codes.",
  "Do not promote account trading, black-market currency, exploits, scripts, or bypasses.",
  "Only mention redeem codes when the source is recorded and the post says codes can expire.",
  "Prefer tips, guides, memes, polls, and safety education over direct sales language.",
  "Use original meme copy or licensed/owned visuals instead of reposting other creators' images."
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function freshnessScore(observedAt: string, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - new Date(observedAt).getTime()) / MS_PER_HOUR);
  if (ageHours <= 6) return 100;
  if (ageHours <= 24) return 90;
  if (ageHours <= 72) return 70;
  if (ageHours <= 168) return 45;
  return 20;
}

function demandScore(signal: RobloxContentSignal, maxEngagement: number): number {
  const engagementPart =
    maxEngagement > 0 ? Math.sqrt(signal.engagement_count / maxEngagement) * 70 : 0;
  const kindBoost =
    signal.kind === "game_trend" ? 20 : signal.kind === "guide_question" ? 15 : signal.kind === "redeem_code" ? 12 : 8;
  return clamp(engagementPart + kindBoost, 0, 100);
}

function riskPenalty(flags: TopicRiskFlag[]): number {
  let penalty = 0;
  for (const flag of flags) {
    if (HARD_SKIP_FLAGS.includes(flag)) penalty += 100;
    else if (flag === "unverified_code") penalty += 25;
    else if (flag === "copyright_repost") penalty += 35;
    else penalty += 15;
  }
  return clamp(penalty, 0, 100);
}

function actionFor(score: number, flags: TopicRiskFlag[]): TopicAction {
  if (flags.some((flag) => HARD_SKIP_FLAGS.includes(flag))) return "skip";
  if (score >= 75 && flags.length === 0) return "publish";
  if (score >= 55) return "review";
  return "skip";
}

function riskLevel(flags: TopicRiskFlag[]): "low" | "medium" | "high" {
  if (flags.some((flag) => HARD_SKIP_FLAGS.includes(flag))) return "high";
  if (flags.length > 0) return "medium";
  return "low";
}

function angleFor(signal: RobloxContentSignal): string {
  const game = signal.game || "Roblox";
  if (signal.kind === "game_trend") return `${game} is getting attention today; turn it into a quick tip or poll.`;
  if (signal.kind === "guide_question") return `Answer a player question with a simple, saveable mini-guide.`;
  if (signal.kind === "redeem_code") return `Share a careful code-check post with source and expiry warning.`;
  if (signal.kind === "meme") return `Use the joke as a lightweight engagement post with an original visual.`;
  if (signal.kind === "safety") return `Build trust with a buying or account-safety reminder.`;
  return `Connect the topic to a soft product reminder without sounding like a hard ad.`;
}

function cleanTitle(title: string): string {
  return title
    .replace(/#\w+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .trim()
    .replace(/[.!?。！？]+$/, "");
}

function topicLabel(signal: RobloxContentSignal): string {
  const title = cleanTitle(signal.title);
  const game = signal.game || "Roblox";
  const topMatch = title.match(/\btop\s+(\d+)\s+["']?([^"']+)["']?/i);
  if (topMatch) return `${game}: top ${topMatch[1]} ${topMatch[2].toLowerCase()} players are comparing`;
  if (/\bhow to\b/i.test(title)) return `${game}: quick answer to a player question`;
  if (/\bbest\b/i.test(title)) return `${game}: best-pick discussion`;
  if (/\bdress|outfit|fit\b/i.test(title)) return `${game}: outfit choice poll`;
  if (/\bmeme|funny|pov\b/i.test(title)) return `${game}: relatable player moment`;
  return `${game}: trending player discussion`;
}

function facebookHook(signal: RobloxContentSignal): string {
  const title = cleanTitle(signal.title);
  const game = signal.game || "Roblox";
  if (/\bdress|outfit|fit\b/i.test(title)) return `Roblox fit check: which look wins?`;
  if (/\btop\s+\d+/i.test(title)) return `${game} players, settle this one.`;
  if (/\bhow to\b/i.test(title)) return `Quick ${game} help for today.`;
  if (/\bbest\b/i.test(title)) return `${game} players are debating the best pick right now.`;
  if (signal.kind === "meme") return `Roblox moment of the day.`;
  if (signal.kind === "safety") return `Small Roblox safety reminder.`;
  return `${game} is getting attention today.`;
}

function facebookBody(signal: RobloxContentSignal): string {
  const title = cleanTitle(signal.title);
  const game = signal.game || "Roblox";
  if (/\bdress|outfit|fit\b/i.test(title)) {
    return `A fashion-style Roblox topic is getting attention, so this is a good moment for a simple poll post.\n\nPick one: clean, cute, chaotic, or full final-boss energy?`;
  }
  if (/\btop\s+\d+/i.test(title)) {
    return `Players are comparing ${title.toLowerCase()}.\n\nIf you had to recommend one choice to a newer player, what would you pick first?`;
  }
  if (/\bhow to\b/i.test(title)) {
    return `A lot of players get stuck on questions like this:\n\n${title}\n\nDrop your fastest method below and help another player out.`;
  }
  if (/\bbest\b/i.test(title)) {
    return `${title}\n\nNo overthinking: what is your current best pick, and why?`;
  }
  if (signal.kind === "meme") {
    return `${title}\n\nBe honest: is this you or your friend?`;
  }
  if (signal.kind === "safety") {
    return `${title}\n\nIf a deal feels too perfect, pause and verify first.`;
  }
  return `${title}\n\nWould you turn this into a guide, a poll, or a meme?`;
}

function facebookCta(signal: RobloxContentSignal): string {
  const title = signal.title.toLowerCase();
  if (/\bdress|outfit|fit\b/.test(title)) return "Comment your winning outfit style.";
  if (/\btop\s+\d+|best\b/.test(title)) return "Drop your pick in the comments.";
  if (/\bhow to|guide|tips?\b/.test(title)) return "Share one tip newer players should know.";
  if (signal.kind === "meme") return "Tag the friend who would do this.";
  return "What should we cover next?";
}

function facebookDraft(signal: RobloxContentSignal, action: TopicAction): string {
  if (signal.kind === "redeem_code") {
    return "";
  }
  const reviewLine = action === "review" ? "\n\nNote: verify the source angle before posting." : "";
  return `${facebookHook(signal)}\n\n${facebookBody(signal)}\n\n${facebookCta(signal)}${reviewLine}`;
}

function xDraft(signal: RobloxContentSignal): string {
  const game = signal.game || "Roblox";
  const base =
    signal.kind === "meme"
      ? `${signal.title} Roblox players know the feeling.`
      : `${game} watch: ${signal.title}`;
  return base.length > 240 ? `${base.slice(0, 237)}...` : base;
}

function imagePrompt(signal: RobloxContentSignal): string {
  const game = signal.game || "Roblox";
  const label = topicLabel(signal);
  if (signal.kind === "meme") {
    return `Original Roblox-style meme image about: ${cleanTitle(signal.title)}. Bright game UI mood, no logos, no copied artwork, square format.`;
  }
  if (signal.kind === "redeem_code") {
    return "";
  }
  return `Square Facebook graphic for ${label}. Colorful Roblox-inspired blocks, original artwork, readable headline area, no official Roblox logo.`;
}

export function buildRobloxTopicReport(params: {
  brand: string;
  audience: string;
  signals: RobloxContentSignal[];
  now?: Date;
  maxCandidates?: number;
}): TodayTopicReport {
  const now = params.now || new Date();
  const maxEngagement = Math.max(...params.signals.map((signal) => signal.engagement_count), 0);

  const candidates = params.signals
    .map((signal): RobloxTopicCandidate => {
      const breakdown = {
        demand: demandScore(signal, maxEngagement),
        business_fit: signal.business_fit,
        trust: signal.reliability,
        interaction: signal.interaction_potential,
        freshness: freshnessScore(signal.observed_at, now),
        risk_penalty: riskPenalty(signal.risk_flags)
      };
      const rawScore =
        0.3 * breakdown.demand +
        0.25 * breakdown.business_fit +
        0.2 * breakdown.trust +
        0.15 * breakdown.interaction +
        0.1 * breakdown.freshness -
        breakdown.risk_penalty;
      const score = round1(clamp(rawScore, 0, 100));
      const action = actionFor(score, signal.risk_flags);

      return {
        id: signal.id,
        title: signal.title,
        angle: angleFor(signal),
        post_type: signal.kind,
        game: signal.game,
        score,
        action,
        risk_level: riskLevel(signal.risk_flags),
        breakdown: {
          demand: round1(breakdown.demand),
          business_fit: round1(breakdown.business_fit),
          trust: round1(breakdown.trust),
          interaction: round1(breakdown.interaction),
          freshness: round1(breakdown.freshness),
          risk_penalty: round1(breakdown.risk_penalty)
        },
        evidence: [
          {
            label: `${signal.source_type}: ${signal.title}`,
            url: signal.source_url
          }
        ],
        draft: {
          facebook_text: facebookDraft(signal, action),
          x_text: xDraft(signal),
          image_prompt: imagePrompt(signal)
        }
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, params.maxCandidates || 10);

  const topPick = candidates.find((candidate) => candidate.action === "publish") || candidates[0] || null;

  return {
    generated_at: now.toISOString(),
    brand: params.brand,
    audience: params.audience,
    candidates,
    top_pick: topPick,
    guardrails: ROBLOX_CONTENT_GUARDRAILS
  };
}
