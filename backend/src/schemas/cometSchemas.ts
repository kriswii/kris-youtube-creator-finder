import { z } from "zod";
import { cometModes, cometParseStatuses } from "../types/comet.js";

export const cometModeSchema = z.enum(cometModes);
export const cometParseStatusSchema = z.enum(cometParseStatuses);

export const cometSummarySchema = z.object({
  id: z.string().min(1),
  job_id: z.string().min(1),
  result_id: z.string().min(1),
  mode: cometModeSchema,
  prompt: z.string().min(1),
  raw_output: z.string().nullable(),
  video_summary: z.string().nullable(),
  comments_summary: z.string().nullable(),
  audience: z.string().nullable(),
  sentiment: z.string().nullable(),
  brand_fit: z.string().nullable(),
  parse_status: cometParseStatusSchema,
  error_message: z.string().nullable(),
  created_at: z.string().datetime()
});

export const manualCometSummaryInputSchema = z.object({
  result_id: z.string().min(1),
  raw_output: z.string().min(1)
});

export const automatedCometSummaryInputSchema = z.object({
  mode: z.literal("automated"),
  result_ids: z.array(z.string().min(1)).optional(),
  wait_ms: z.number().int().positive().max(120000).default(20000)
});

export const runCometSchema = z.discriminatedUnion("mode", [
  automatedCometSummaryInputSchema,
  z.object({
    mode: z.literal("manual"),
    result_id: z.string().min(1),
    raw_output: z.string().min(1)
  })
]);
