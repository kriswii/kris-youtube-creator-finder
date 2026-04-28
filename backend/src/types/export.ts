export const exportFormats = ["csv", "xlsx"] as const;
export type ExportFormat = (typeof exportFormats)[number];

export const exportStatuses = ["pending", "completed", "failed"] as const;
export type ExportStatus = (typeof exportStatuses)[number];

export interface ExportRecord {
  id: string;
  job_id: string;
  format: ExportFormat;
  file_path: string;
  row_count: number;
  status: ExportStatus;
  error_message: string | null;
  created_at: string;
}
