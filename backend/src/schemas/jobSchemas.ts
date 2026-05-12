import { z } from "zod";
import { jobStages, jobStatuses } from "../types/job.js";

export const jobStatusSchema = z.enum(jobStatuses);
export const jobStageSchema = z.enum(jobStages);

const COUNTRY_ALIASES: Record<string, string[]> = {
  PH: ["PH", "PHILIPPINES", "FILIPINO", "PINOY", "菲律宾", "菲律賓"],
  ID: ["ID", "INDONESIA", "INDONESIAN", "INDO"],
  TH: ["TH", "THAILAND", "THAI"],
  BR: ["BR", "BRAZIL", "BRASIL", "BRAZILIAN"],
  SG: ["SG", "SINGAPORE", "SINGAPOREAN"],
  MY: ["MY", "MALAYSIA", "MALAYSIAN"],
  VN: ["VN", "VIETNAM", "VIETNAMESE"],
  KR: ["KR", "KOREA", "SOUTH KOREA", "KOREAN"],
  JP: ["JP", "JAPAN", "JAPANESE"],
  TW: ["TW", "TAIWAN", "TAIWANESE"],
  US: ["US", "UNITED STATES", "USA", "AMERICA", "AMERICAN"]
};

function normalizeCountryInput(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim();
  if (!normalized) return undefined;

  const upper = normalized.toUpperCase();
  for (const [code, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.includes(upper) || aliases.includes(normalized)) return code;
  }

  return upper.length === 2 ? upper : undefined;
}

export const createJobSchema = z.object({
  keyword: z.string().trim().min(1),
  lookback_days: z.number().int().positive().default(14),
  subscriber_min: z.number().int().nonnegative().default(100),
  subscriber_max: z.number().int().nonnegative().default(5000000),
  max_candidates: z.number().int().positive().default(500),
  shortlist_size: z.number().int().positive().default(100),
  minimum_pre_score: z.number().min(0).max(100).default(0),
  channel_country: z.string().optional().transform(normalizeCountryInput)
});

export const jobRecordSchema = createJobSchema.extend({
  id: z.string().min(1),
  status: jobStatusSchema,
  stage: jobStageSchema,
  config_json: z.string(),
  error_message: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type JobRecordSchema = z.infer<typeof jobRecordSchema>;
