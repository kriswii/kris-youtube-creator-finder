export const opportunityTiers = ["A", "B", "C", "D"] as const;
export type OpportunityTier = (typeof opportunityTiers)[number];

export const outreachPriorities = ["P1", "P2", "P3", "P4"] as const;
export type OutreachPriority = (typeof outreachPriorities)[number];

export interface ScoringInput {
  views: number;
  likes: number;
  comments: number;
  subscribers: number;
  published_at: string;
  now?: Date;
}

export interface PreScoreBreakdown {
  sub_fit_score: number;
  view_sub_score: number;
  engagement_score: number;
  comment_score: number;
  relative_velocity_score: number;
}

export interface FinalScoreBreakdown {
  pre_score_norm: number;
  contactability_norm: number;
  content_fit_norm: number;
  audience_fit_norm: number;
  brand_safety_norm: number;
}
