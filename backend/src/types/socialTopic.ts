export type SocialPlatform = "facebook" | "x" | "instagram" | "tiktok";

export type RobloxSignalKind =
  | "game_trend"
  | "guide_question"
  | "redeem_code"
  | "meme"
  | "safety"
  | "commerce";

export type RobloxSourceType =
  | "official"
  | "creator"
  | "community"
  | "search_trend"
  | "internal";

export type TopicRiskFlag =
  | "free_robux_claim"
  | "account_trading"
  | "unverified_code"
  | "off_platform_currency_sale"
  | "copyright_repost"
  | "minor_targeting";

export type TopicAction = "publish" | "review" | "skip";

export interface RobloxContentSignal {
  id: string;
  kind: RobloxSignalKind;
  source_type: RobloxSourceType;
  title: string;
  game?: string;
  source_url?: string;
  observed_at: string;
  engagement_count: number;
  business_fit: number;
  interaction_potential: number;
  reliability: number;
  tags: string[];
  risk_flags: TopicRiskFlag[];
  notes?: string;
}

export interface TopicScoreBreakdown {
  demand: number;
  business_fit: number;
  trust: number;
  interaction: number;
  freshness: number;
  risk_penalty: number;
}

export interface RobloxTopicCandidate {
  id: string;
  title: string;
  angle: string;
  post_type: RobloxSignalKind;
  game?: string;
  score: number;
  action: TopicAction;
  risk_level: "low" | "medium" | "high";
  breakdown: TopicScoreBreakdown;
  evidence: Array<{
    label: string;
    url?: string;
  }>;
  draft: {
    facebook_text: string;
    x_text: string;
    image_prompt: string;
  };
}

export interface TodayTopicReport {
  generated_at: string;
  brand: string;
  audience: string;
  candidates: RobloxTopicCandidate[];
  top_pick: RobloxTopicCandidate | null;
  guardrails: string[];
}
