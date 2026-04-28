import type { ContactStatus } from "./contact.js";
import type { MiniMaxStatus } from "./minimax.js";
import type { OpportunityTier, OutreachPriority } from "./scoring.js";

export const resultStatuses = [
  "candidate",
  "enriched",
  "pre_scored",
  "shortlisted",
  "contacted",
  "summarized",
  "analyzed",
  "exported",
  "rejected",
  "failed"
] as const;
export type ResultStatus = (typeof resultStatuses)[number];

export interface CreatorResult {
  id: string;
  job_id: string;
  keyword: string;
  video_id: string;
  video_url: string;
  title: string | null;
  published_at: string | null;
  raw_search_rank: number | null;
  search_page: number | null;
  search_source: string | null;
  views: number;
  likes: number;
  comments: number;
  subscribers: number;
  channel_id: string | null;
  channel_title: string | null;
  channel_description: string | null;
  channel_avatar_url: string | null;
  channel_country: string | null;
  channel_country_source: string | null;
  video_language: string | null;
  days_since_publish: number | null;
  engagement_rate: number | null;
  comment_rate: number | null;
  view_sub_ratio: number | null;
  relative_velocity: number | null;
  sub_fit_score: number | null;
  view_sub_score: number | null;
  engagement_score: number | null;
  comment_score: number | null;
  relative_velocity_score: number | null;
  pre_score: number | null;
  pre_score_breakdown_json: string | null;
  opportunity_tier: OpportunityTier | null;
  public_email: string | null;
  social_links_json: string | null;
  website_url: string | null;
  contactability_score: number | null;
  contact_status: ContactStatus | null;
  raw_comet_output: string | null;
  comet_video_summary: string | null;
  comet_comments_summary: string | null;
  minimax_content_type: string | null;
  minimax_content_fit_score: number | null;
  minimax_audience_fit_score: number | null;
  minimax_brand_safety_score: number | null;
  minimax_commercial_intent_score: number | null;
  minimax_reason: string | null;
  minimax_status: MiniMaxStatus | null;
  minimax_error: string | null;
  final_score: number | null;
  final_score_breakdown_json: string | null;
  outreach_priority: OutreachPriority | null;
  status: ResultStatus;
  created_at: string;
  updated_at: string;
}
