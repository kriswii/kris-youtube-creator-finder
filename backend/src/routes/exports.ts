import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SqliteDatabase } from "../lib/db.js";

export interface ExportRouteResult {
  handled: boolean;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "text/csv; charset=utf-8";
}

export async function handleExportsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  db: SqliteDatabase
): Promise<ExportRouteResult> {
  const match = pathname.match(/^\/api\/exports\/([^/]+)\/download$/);
  if (!match) return { handled: false };

  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return { handled: true };
  }

  const [, exportId] = match;
  const record = db.prepare("SELECT * FROM exports WHERE id = ?").get(exportId) as
    | { file_path: string; format: string; status: string }
    | undefined;

  if (!record) {
    sendJson(res, 404, { ok: false, error: "Export not found" });
    return { handled: true };
  }

  if (record.status !== "completed" || !record.file_path || !fs.existsSync(record.file_path)) {
    sendJson(res, 404, { ok: false, error: "Export file is not available" });
    return { handled: true };
  }

  res.writeHead(200, {
    "Content-Type": getMimeType(record.file_path),
    "Content-Disposition": `attachment; filename="${path.basename(record.file_path)}"`
  });
  fs.createReadStream(record.file_path).pipe(res);
  return { handled: true };
}
