export const minimaxStatuses = ["pending", "completed", "failed"] as const;
export type MiniMaxStatus = (typeof minimaxStatuses)[number];

export interface MiniMaxAnalysis {
  content_type: string;
  content_fit_score: number;
  audience_fit_score: number;
  brand_safety_score: number;
  commercial_intent_score: number;
  reason: string;
}
