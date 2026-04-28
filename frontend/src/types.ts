export type JobStage =
  | "created"
  | "search"
  | "enrichment"
  | "pre_score"
  | "shortlist"
  | "export"
  | "done"
  | "failed";

export type ResultStatus =
  | "candidate"
  | "enriched"
  | "pre_scored"
  | "shortlisted"
  | "exported"
  | "rejected"
  | "failed";

export type OpportunityTier = "A" | "B" | "C" | "D";

export interface JobRecord {
  id: string;
  keyword: string;
  lookback_days: number;
  subscriber_min: number;
  subscriber_max: number;
  max_candidates: number;
  shortlist_size: number;
  minimum_pre_score: number;
  channel_country?: string;
  status: string;
  stage: JobStage;
  config_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

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
  channel_description?: string | null;
  channel_avatar_url: string | null;
  channel_country: string | null;
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
  contact_status: string | null;
  contactability_score: number | null;
  raw_comet_output: string | null;
  comet_video_summary: string | null;
  comet_comments_summary: string | null;
  minimax_content_type: string | null;
  minimax_content_fit_score: number | null;
  minimax_audience_fit_score: number | null;
  minimax_brand_safety_score: number | null;
  minimax_commercial_intent_score: number | null;
  minimax_reason: string | null;
  minimax_status: string | null;
  minimax_error: string | null;
  final_score: number | null;
  outreach_priority: string | null;
  status: ResultStatus;
  created_at: string;
  updated_at: string;
}

export interface ExportRecord {
  id: string;
  job_id: string;
  format: "csv" | "xlsx";
  file_path: string;
  row_count: number;
  status: "pending" | "completed" | "failed";
  error_message: string | null;
  created_at: string;
}

export interface QuotaSummary {
  usage_date: string;
  daily_limit: number;
  used_units: number;
  remaining_units: number;
  percent_used: number;
}

export interface JobDetailResponse {
  ok: boolean;
  job: JobRecord;
  results: CreatorResult[];
  exports: ExportRecord[];
}

export interface CreateJobInput {
  keyword: string;
  lookback_days: number;
  subscriber_min: number;
  subscriber_max: number;
  max_candidates: number;
  shortlist_size: number;
  minimum_pre_score: number;
  channel_country?: string;
}
