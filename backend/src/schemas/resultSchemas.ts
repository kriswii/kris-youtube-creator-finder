import { z } from "zod";
import { contactStatusSchema } from "./contactSchemas.js";
import { minimaxStatusSchema } from "./minimaxSchemas.js";
import { opportunityTierSchema, outreachPrioritySchema } from "./scoringSchemas.js";
import { resultStatuses } from "../types/result.js";

export const resultStatusSchema = z.enum(resultStatuses);

const nullableScore = z.number().min(0).nullable();
const nullableNormalized = z.number().min(0).max(1).nullable();

export const creatorResultSchema = z.object({
  id: z.string().min(1),
  job_id: z.string().min(1),
  keyword: z.string().min(1),
  video_id: z.string().min(1),
  video_url: z.string().url(),
  title: z.string().nullable(),
  published_at: z.string().datetime().nullable(),
  raw_search_rank: z.number().int().nonnegative().nullable(),
  search_page: z.number().int().nonnegative().nullable(),
  search_source: z.string().nullable(),
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  subscribers: z.number().int().nonnegative(),
  channel_id: z.string().nullable(),
  channel_title: z.string().nullable(),
  channel_avatar_url: z.string().url().nullable(),
  channel_country: z.string().nullable(),
  days_since_publish: z.number().int().positive().nullable(),
  engagement_rate: nullableScore,
  comment_rate: nullableScore,
  view_sub_ratio: nullableScore,
  relative_velocity: nullableScore,
  sub_fit_score: nullableNormalized,
  view_sub_score: nullableNormalized,
  engagement_score: nullableNormalized,
  comment_score: nullableNormalized,
  relative_velocity_score: nullableNormalized,
  pre_score: z.number().min(0).max(100).nullable(),
  pre_score_breakdown_json: z.string().nullable(),
  opportunity_tier: opportunityTierSchema.nullable(),
  public_email: z.string().email().nullable(),
  social_links_json: z.string().nullable(),
  website_url: z.string().url().nullable(),
  contactability_score: z.number().min(0).max(100).nullable(),
  contact_status: contactStatusSchema.nullable(),
  raw_comet_output: z.string().nullable(),
  comet_video_summary: z.string().nullable(),
  comet_comments_summary: z.string().nullable(),
  minimax_content_type: z.string().nullable(),
  minimax_content_fit_score: z.number().min(0).max(100).nullable(),
  minimax_audience_fit_score: z.number().min(0).max(100).nullable(),
  minimax_brand_safety_score: z.number().min(0).max(100).nullable(),
  minimax_commercial_intent_score: z.number().min(0).max(100).nullable(),
  minimax_reason: z.string().nullable(),
  minimax_status: minimaxStatusSchema.nullable(),
  minimax_error: z.string().nullable(),
  final_score: z.number().min(0).max(100).nullable(),
  final_score_breakdown_json: z.string().nullable(),
  outreach_priority: outreachPrioritySchema.nullable(),
  status: resultStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});
