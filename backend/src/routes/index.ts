import type { IncomingMessage, ServerResponse } from "node:http";
import { handleJobsRoute } from "./jobs.js";
import type { SqliteDatabase } from "../lib/db.js";
import { handleExportsRoute } from "./exports.js";
import { getQuotaSummary } from "../services/youtube/quotaService.js";

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export async function routeRequest(req: IncomingMessage, res: ServerResponse, db: SqliteDatabase): Promise<void> {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "youtube-creator-pipeline-backend" }));
    return;
  }

  if (url.pathname === "/api/quota-summary" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, quota: getQuotaSummary(db) }));
    return;
  }

  const jobsResult = await handleJobsRoute(req, res, url.pathname, db);
  if (jobsResult.handled) return;

  const exportsResult = await handleExportsRoute(req, res, url.pathname, db);
  if (exportsResult.handled) return;

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
}
