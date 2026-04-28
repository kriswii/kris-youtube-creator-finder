import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import type { SqliteDatabase } from "../../lib/db.js";
import { stringifyJson } from "../../lib/json.js";
import { nowIso } from "../../lib/time.js";

export interface QuotaUsageRecordInput {
  jobId?: string | null;
  actionType: "search.list" | "videos.list" | "channels.list";
  units: number;
  detail?: Record<string, unknown>;
}

export interface QuotaSummary {
  usage_date: string;
  daily_limit: number;
  used_units: number;
  remaining_units: number;
  percent_used: number;
}

function pacificDate(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(now);
}

export function recordQuotaUsage(db: SqliteDatabase, input: QuotaUsageRecordInput): void {
  db.prepare(
    `INSERT INTO quota_usage_logs (
      id, job_id, usage_date, action_type, units, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.jobId ?? null,
    pacificDate(),
    input.actionType,
    input.units,
    input.detail ? stringifyJson(input.detail) : null,
    nowIso()
  );
}

export function getQuotaSummary(db: SqliteDatabase): QuotaSummary {
  const usageDate = pacificDate();
  const row =
    (db.prepare("SELECT COALESCE(SUM(units), 0) AS used_units FROM quota_usage_logs WHERE usage_date = ?").get(
      usageDate
    ) as { used_units: number } | undefined) ?? { used_units: 0 };

  const usedUnits = Number(row.used_units ?? 0);
  const dailyLimit = env.YOUTUBE_DAILY_QUOTA_LIMIT;
  const remainingUnits = Math.max(0, dailyLimit - usedUnits);
  const percentUsed = dailyLimit > 0 ? Math.min(100, (usedUnits / dailyLimit) * 100) : 0;

  return {
    usage_date: usageDate,
    daily_limit: dailyLimit,
    used_units: usedUnits,
    remaining_units: remainingUnits,
    percent_used: Number(percentUsed.toFixed(2))
  };
}
