import type { CreateJobInput, JobDetailResponse, JobRecord, QuotaSummary } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

function buildApiUrl(path: string): string {
  const base = String(API_BASE).replace(/\/$/, "");
  if (base.endsWith("/api") && path.startsWith("/api/")) {
    return `${base}${path.slice(4)}`;
  }
  return `${base}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function createJob(input: CreateJobInput): Promise<JobRecord> {
  const data = await request<{ ok: boolean; job: JobRecord }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.job;
}

export async function fetchJob(jobId: string): Promise<JobDetailResponse> {
  return request<JobDetailResponse>(`/api/jobs/${jobId}`);
}

export async function runStage(
  jobId: string,
  action:
    | "run-search"
    | "run-enrichment"
    | "run-pre-score"
    | "run-shortlist",
  body?: unknown
): Promise<unknown> {
  return request(`/api/jobs/${jobId}/${action}`, {
    method: "POST",
    body: body ? JSON.stringify(body) : "{}"
  });
}

export async function runExport(
  jobId: string,
  format: "csv" | "xlsx"
): Promise<{ download_url: string; filename?: string; file_path?: string }> {
  return request<{ ok: boolean; download_url: string; filename?: string; file_path?: string }>(`/api/jobs/${jobId}/run-export`, {
    method: "POST",
    body: JSON.stringify({ format })
  });
}

export async function fetchQuotaSummary(): Promise<QuotaSummary> {
  const data = await request<{ ok: boolean; quota: QuotaSummary }>("/api/quota-summary");
  return data.quota;
}
