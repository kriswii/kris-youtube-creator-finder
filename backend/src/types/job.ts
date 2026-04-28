export const jobStatuses = ["draft", "running", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const jobStages = [
  "created",
  "search",
  "enrichment",
  "pre_score",
  "shortlist",
  "contacts",
  "comet",
  "minimax",
  "export",
  "done",
  "failed"
] as const;
export type JobStage = (typeof jobStages)[number];

export interface JobConfig {
  keyword: string;
  lookback_days: number;
  subscriber_min: number;
  subscriber_max: number;
  max_candidates: number;
  shortlist_size: number;
  minimum_pre_score: number;
  channel_country?: string;
}

export interface JobRecord extends JobConfig {
  id: string;
  status: JobStatus;
  stage: JobStage;
  config_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
