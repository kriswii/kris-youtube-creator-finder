import { z } from "zod";
import { opportunityTiers, outreachPriorities } from "../types/scoring.js";

export const opportunityTierSchema = z.enum(opportunityTiers);
export const outreachPrioritySchema = z.enum(outreachPriorities);

export const scoringInputSchema = z.object({
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  subscribers: z.number().int().nonnegative(),
  published_at: z.string().datetime(),
  now: z.date().optional()
});

export const preScoreBreakdownSchema = z.object({
  sub_fit_score: z.number().min(0).max(1),
  view_sub_score: z.number().min(0).max(1),
  engagement_score: z.number().min(0).max(1),
  comment_score: z.number().min(0).max(1),
  relative_velocity_score: z.number().min(0).max(1)
});

export const finalScoreBreakdownSchema = z.object({
  pre_score_norm: z.number().min(0).max(1),
  contactability_norm: z.number().min(0).max(1),
  content_fit_norm: z.number().min(0).max(1),
  audience_fit_norm: z.number().min(0).max(1),
  brand_safety_norm: z.number().min(0).max(1)
});
