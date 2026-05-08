import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { env } from "../../config/env.js";
import type { CreatorResult } from "../../types/result.js";
import type { ExportFormat } from "../../types/export.js";

export interface ExportRow {
  keyword: string;
  representative_title: string;
  channel_title: string;
  channel_url: string;
  channel_id: string;
  channel_country: string;
  channel_country_source: string;
  video_language: string;
  published_at: string;
  views: number | string;
  subscribers: number | string;
  status: string;
}

export interface ExportColumn {
  key: keyof ExportRow;
  label: string;
}

export const exportColumns: ExportColumn[] = [
  { key: "keyword", label: "keyword" },
  { key: "representative_title", label: "representative_title" },
  { key: "channel_title", label: "channel_title" },
  { key: "channel_url", label: "channel_url" },
  { key: "channel_id", label: "channel_id" },
  { key: "channel_country", label: "channel_country" },
  { key: "channel_country_source", label: "channel_country_source" },
  { key: "video_language", label: "video_language" },
  { key: "published_at", label: "published_at" },
  { key: "views", label: "views" },
  { key: "subscribers", label: "subscribers" },
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

function buildChannelUrl(result: CreatorResult): string {
  const channelId = result.channel_id?.trim();
  if (channelId) {
    return `https://www.youtube.com/channel/${channelId}`;
  }
  return "";
}

export function createExportRows(results: CreatorResult[]): Record<string, string | number>[] {
  return results.map((result) => {
    const row: ExportRow = {
      keyword: result.keyword ?? "",
      representative_title: result.title ?? "",
      channel_title: result.channel_title ?? "",
      channel_url: buildChannelUrl(result),
      channel_id: result.channel_id ?? "",
      channel_country: result.channel_country ?? "",
      channel_country_source: result.channel_country_source ?? "",
      video_language: result.video_language ?? "",
      published_at: result.published_at ?? "",
      views: result.views ?? "",
      subscribers: result.subscribers ?? "",
      status: result.status ?? ""
    };

    return Object.fromEntries(exportColumns.map((column) => [column.label, normalizeCell(row[column.key])]));
  });
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
