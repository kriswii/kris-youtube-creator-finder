import { z } from "zod";
import { minimaxStatuses } from "../types/minimax.js";

export const minimaxStatusSchema = z.enum(minimaxStatuses);

export const minimaxAnalysisSchema = z.object({
  content_type: z.string().min(1),
  content_fit_score: z.number().min(0).max(100),
  audience_fit_score: z.number().min(0).max(100),
  brand_safety_score: z.number().min(0).max(100),
  commercial_intent_score: z.number().min(0).max(100),
  reason: z.string().min(1)
});

export const runMiniMaxSchema = z.object({
  result_ids: z.array(z.string().min(1)).optional()
});
