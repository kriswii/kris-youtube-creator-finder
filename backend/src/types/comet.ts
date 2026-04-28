export const cometModes = ["automated", "manual"] as const;
export type CometMode = (typeof cometModes)[number];

export const cometParseStatuses = ["pending", "parsed", "failed"] as const;
export type CometParseStatus = (typeof cometParseStatuses)[number];

export interface CometSummaryRecord {
  id: string;
  job_id: string;
  result_id: string;
  mode: CometMode;
  prompt: string;
  raw_output: string | null;
  video_summary: string | null;
  comments_summary: string | null;
  audience: string | null;
  sentiment: string | null;
  brand_fit: string | null;
  parse_status: CometParseStatus;
  error_message: string | null;
  created_at: string;
}
