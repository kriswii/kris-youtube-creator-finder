import { z } from "zod";
import { exportFormats, exportStatuses } from "../types/export.js";

export const exportFormatSchema = z.enum(exportFormats);
export const exportStatusSchema = z.enum(exportStatuses);

export const exportRecordSchema = z.object({
  id: z.string().min(1),
  job_id: z.string().min(1),
  format: exportFormatSchema,
  file_path: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  status: exportStatusSchema,
  error_message: z.string().nullable(),
  created_at: z.string().datetime()
});

export const runExportSchema = z.object({
  format: exportFormatSchema.default("csv")
});
