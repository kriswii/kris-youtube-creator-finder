import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { env } from "../../config/env.js";
import type { CreatorResult } from "../../types/result.js";
import type { ExportFormat } from "../../types/export.js";

export interface ExportColumn {
  key: keyof CreatorResult;
  label: string;
}

export const exportColumns: ExportColumn[] = [
  { key: "keyword", label: "keyword" },
  { key: "video_id", label: "video_id" },
  { key: "video_url", label: "video_url" },
  { key: "title", label: "title" },
  { key: "channel_title", label: "channel_title" },
  { key: "channel_id", label: "channel_id" },
  { key: "channel_country", label: "channel_country" },
  { key: "channel_country_source", label: "channel_country_source" },
  { key: "video_language", label: "video_language" },
  { key: "published_at", label: "published_at" },
  { key: "days_since_publish", label: "days_since_publish" },
  { key: "views", label: "views" },
  { key: "likes", label: "likes" },
  { key: "comments", label: "comments" },
  { key: "subscribers", label: "subscribers" },
  { key: "engagement_rate", label: "engagement_rate" },
  { key: "comment_rate", label: "comment_rate" },
  { key: "view_sub_ratio", label: "view_sub_ratio" },
  { key: "relative_velocity", label: "relative_velocity" },
  { key: "sub_fit_score", label: "sub_fit_score" },
  { key: "view_sub_score", label: "view_sub_score" },
  { key: "engagement_score", label: "engagement_score" },
  { key: "comment_score", label: "comment_score" },
  { key: "relative_velocity_score", label: "relative_velocity_score" },
  { key: "pre_score", label: "pre_score" },
  { key: "opportunity_tier", label: "opportunity_tier" },
  { key: "status", label: "status" }
];

function ensureExportDirectory(): string {
  const dir = path.isAbsolute(env.EXPORT_DIR) ? env.EXPORT_DIR : path.resolve(process.cwd(), env.EXPORT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeCell(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return String(value);
}

export function createExportRows(results: CreatorResult[]): Record<string, string | number>[] {
  return results.map((result) =>
    Object.fromEntries(exportColumns.map((column) => [column.label, normalizeCell(result[column.key])]))
  );
}

export function writeCsvExport(filePath: string, rows: Record<string, string | number>[]): void {
  const headers = exportColumns.map((column) => column.label);
  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const raw = String(row[header] ?? "");
          const escaped = raw.replaceAll('"', '""');
          return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
        })
        .join(",")
    )
  ];
  fs.writeFileSync(filePath, `\uFEFF${csvLines.join("\r\n")}`, "utf8");
}

export function writeXlsxExport(filePath: string, rows: Record<string, string | number>[]): void {
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: exportColumns.map((column) => column.label)
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "results");
  XLSX.writeFile(workbook, filePath);
}

export function createExportFile(jobId: string, format: ExportFormat, results: CreatorResult[]): {
  filePath: string;
  rowCount: number;
} {
  const exportDir = ensureExportDirectory();
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const filePath = path.join(exportDir, `${jobId}-${timestamp}.${format}`);
  const rows = createExportRows(results);

  if (format === "csv") {
    writeCsvExport(filePath, rows);
  } else {
    writeXlsxExport(filePath, rows);
  }

  return {
    filePath,
    rowCount: rows.length
  };
}
