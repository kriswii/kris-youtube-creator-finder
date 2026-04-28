import { chromium, type BrowserContext, type Page } from "playwright-core";
import { env } from "../../config/env.js";
import type { CometMode, CometSummaryRecord } from "../../types/comet.js";

export const COMET_PROMPT = `Summarize this YouTube video and the visible comments.
Return in this exact format:

VIDEO_SUMMARY:
<text>

COMMENTS_SUMMARY:
<text>

AUDIENCE:
<text>

SENTIMENT:
<text>

BRAND_FIT:
<text>`;

export interface ParsedCometSections {
  video_summary: string | null;
  comments_summary: string | null;
  audience: string | null;
  sentiment: string | null;
  brand_fit: string | null;
}

export interface ParsedCometOutput extends ParsedCometSections {
  parse_status: "parsed" | "failed";
  error_message: string | null;
}

function normalizeBlock(value: string | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function parseCometRawOutput(rawOutput: string): ParsedCometOutput {
  const text = String(rawOutput || "").replace(/\r/g, "").trim();
  const pattern =
    /VIDEO_SUMMARY:\s*([\s\S]*?)\nCOMMENTS_SUMMARY:\s*([\s\S]*?)\nAUDIENCE:\s*([\s\S]*?)\nSENTIMENT:\s*([\s\S]*?)\nBRAND_FIT:\s*([\s\S]*)$/i;
  const match = text.match(pattern);

  if (!match) {
    return {
      video_summary: null,
      comments_summary: null,
      audience: null,
      sentiment: null,
      brand_fit: null,
      parse_status: "failed",
      error_message: "Comet output did not match the required format."
    };
  }

  return {
    video_summary: normalizeBlock(match[1]),
    comments_summary: normalizeBlock(match[2]),
    audience: normalizeBlock(match[3]),
    sentiment: normalizeBlock(match[4]),
    brand_fit: normalizeBlock(match[5]),
    parse_status: "parsed",
    error_message: null
  };
}

async function connectContext(cdpUrl: string): Promise<BrowserContext> {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30000 });
  return browser.contexts()[0] || (await browser.newContext());
}

async function getOrCreateYouTubePage(context: BrowserContext, videoUrl: string): Promise<Page> {
  const existing = context.pages().find((page) => page.url().includes("youtube.com/watch"));
  const page = existing ?? (await context.newPage());
  if (page.url() !== videoUrl) {
    await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }
  return page;
}

async function findSidecarPage(context: BrowserContext): Promise<Page | null> {
  return context.pages().find((page) => page.url().includes("/sidecar")) ?? null;
}

async function openAssistantFromYoutube(page: Page): Promise<Page | null> {
  const context = page.context();
  for (const selector of ["text=助手", "button:has-text('助手')", "[aria-label*='助手']"]) {
    try {
      const target = page.locator(selector).first();
      if (await target.count()) {
        await target.click({ timeout: 2500 });
        await page.waitForTimeout(2000);
        const sidecar = await findSidecarPage(context);
        if (sidecar) return sidecar;
      }
    } catch {
      // Ignore and continue.
    }
  }
  return null;
}

async function scrollToComments(youtubePage: Page): Promise<void> {
  await youtubePage.bringToFront();
  for (let index = 0; index < 8; index += 1) {
    await youtubePage.mouse.wheel(0, 1400);
    await youtubePage.waitForTimeout(800);
    const count = await youtubePage.locator("ytd-comment-thread-renderer").count().catch(() => 0);
    if (count > 0) return;
  }
}

async function getComposer(sidecarPage: Page) {
  for (const selector of ['[contenteditable="true"]', '[role="textbox"]', "textarea"]) {
    const locator = sidecarPage.locator(selector).first();
    if (await locator.count().catch(() => 0)) return locator;
  }
  throw new Error("Could not find Comet assistant composer.");
}

async function captureSidecarText(sidecarPage: Page): Promise<string> {
  return sidecarPage.locator("body").innerText().catch(() => "");
}

function extractDelta(beforeText: string, afterText: string): string {
  const beforeLines = beforeText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const afterLines = afterText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }
  const delta = afterLines.slice(prefix).join("\n").trim();
  return delta || afterLines.slice(-60).join("\n").trim();
}

export async function runAutomatedCometSummary(videoUrl: string, waitMs = 20000): Promise<string> {
  const context = await connectContext(env.COMET_CDP_URL);

  try {
    const youtubePage = await getOrCreateYouTubePage(context, videoUrl);
    await scrollToComments(youtubePage);
    let sidecarPage = await findSidecarPage(context);
    if (!sidecarPage) {
      sidecarPage = await openAssistantFromYoutube(youtubePage);
    }
    if (!sidecarPage) {
      throw new Error("Could not find Comet sidecar page. Open the assistant in Comet first.");
    }

    await sidecarPage.bringToFront();
    const beforeText = await captureSidecarText(sidecarPage);
    const composer = await getComposer(sidecarPage);
    await composer.click();

    try {
      await composer.fill("");
      await composer.fill(COMET_PROMPT);
    } catch {
      await sidecarPage.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await sidecarPage.keyboard.press("Backspace");
      await sidecarPage.keyboard.insertText(COMET_PROMPT);
    }

    await sidecarPage.keyboard.press("Enter");
    await sidecarPage.waitForTimeout(waitMs);
    const afterText = await captureSidecarText(sidecarPage);
    const rawReply = extractDelta(beforeText, afterText);
    if (!rawReply) {
      throw new Error("Comet did not return visible text within the wait window.");
    }
    return rawReply;
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

export function buildCometRecord(input: {
  id: string;
  job_id: string;
  result_id: string;
  mode: CometMode;
  raw_output: string;
  created_at: string;
}): CometSummaryRecord {
  const parsed = parseCometRawOutput(input.raw_output);
  return {
    id: input.id,
    job_id: input.job_id,
    result_id: input.result_id,
    mode: input.mode,
    prompt: COMET_PROMPT,
    raw_output: input.raw_output,
    video_summary: parsed.video_summary,
    comments_summary: parsed.comments_summary,
    audience: parsed.audience,
    sentiment: parsed.sentiment,
    brand_fit: parsed.brand_fit,
    parse_status: parsed.parse_status,
    error_message: parsed.error_message,
    created_at: input.created_at
  };
}
