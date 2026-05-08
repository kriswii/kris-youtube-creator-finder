import { env } from "../../config/env.js";
import { createBrowserSession, dismissConsent } from "./browserSession.js";

export interface WebSearchCandidatesInput {
  keyword: string;
  maxCandidates?: number;
  cdpUrl?: string;
}

export interface WebSearchCandidate {
  video_id: string;
  video_url: string;
  title: string;
  published_at: string;
  raw_search_rank: number;
  search_page: number;
  search_source: "youtube_web_search";
  channel_id: string;
  channel_title: string;
}

export interface WebSearchCandidatesResult {
  candidates: WebSearchCandidate[];
  pages_fetched: number;
}

interface RawSearchCard {
  video_url: string;
  title: string;
  channel_title: string;
  channel_url: string;
}

function extractVideoId(videoUrl: string): string {
  try {
    const url = new URL(videoUrl);
    return url.searchParams.get("v") ?? "";
  } catch {
    return "";
  }
}

function extractChannelIdentifier(channelUrl: string): string {
  try {
    const url = new URL(channelUrl, "https://www.youtube.com");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) return parts[1];
    if (parts[0]?.startsWith("@")) return parts[0];
  } catch {
    // Ignore malformed URLs.
  }
  return "";
}

async function collectVisibleVideoCards(page: Awaited<ReturnType<typeof createBrowserSession>>["page"]): Promise<RawSearchCard[]> {
  return page.evaluate(() => {
    const root = globalThis as typeof globalThis & {
      document?: {
        querySelectorAll: (selector: string) => ArrayLike<unknown>;
      };
    };
    const doc = root.document;

    const cards = Array.from(doc?.querySelectorAll("ytd-video-renderer") ?? []) as Array<{
      querySelector: (selector: string) => {
        href?: string | null;
        textContent?: string | null;
      } | null;
    }>;
    const results: RawSearchCard[] = [];

    for (const card of cards) {
      const titleAnchor = card.querySelector("a#video-title");
      const channelAnchor =
        card.querySelector("ytd-channel-name a") ??
        card.querySelector("a.yt-simple-endpoint.yt-formatted-string");

      const rawVideoHref = titleAnchor?.href ?? "";
      const rawChannelHref = channelAnchor?.href ?? "";
      const rawTitle = titleAnchor?.textContent ?? "";
      const rawChannelTitle = channelAnchor?.textContent ?? "";

      let videoUrl = "";
      let channelUrl = "";
      try {
        videoUrl = rawVideoHref ? new URL(rawVideoHref, "https://www.youtube.com").toString() : "";
      } catch {
        videoUrl = rawVideoHref;
      }
      try {
        channelUrl = rawChannelHref ? new URL(rawChannelHref, "https://www.youtube.com").toString() : "";
      } catch {
        channelUrl = rawChannelHref;
      }

      const title = rawTitle.replace(/\s+/g, " ").trim();
      const channelTitle = rawChannelTitle.replace(/\s+/g, " ").trim();

      if (!videoUrl || !title) continue;
      results.push({
        video_url: videoUrl,
        title,
        channel_title: channelTitle,
        channel_url: channelUrl
      });
    }

    return results;
  });
}

export async function searchCandidatesViaYouTubeWeb(input: WebSearchCandidatesInput): Promise<WebSearchCandidatesResult> {
  const session = await createBrowserSession(input.cdpUrl || env.BROWSER_CDP_URL, true);
  const { page } = session;
  const maxCandidates = Math.max(1, input.maxCandidates ?? 200);
  const candidates: WebSearchCandidate[] = [];
  const seenVideoIds = new Set<string>();
  let stagnantRounds = 0;
  let scrollRounds = 0;

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(input.keyword)}&sp=EgIQAQ%253D%253D`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await dismissConsent(page);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    while (candidates.length < maxCandidates && stagnantRounds < 6) {
      const beforeCount = candidates.length;
      const cards = await collectVisibleVideoCards(page);

      for (const card of cards) {
        const videoId = extractVideoId(card.video_url);
        if (!videoId || seenVideoIds.has(videoId)) continue;
        seenVideoIds.add(videoId);

        candidates.push({
          video_id: videoId,
          video_url: card.video_url,
          title: card.title,
          published_at: "",
          raw_search_rank: candidates.length + 1,
          search_page: 1,
          search_source: "youtube_web_search",
          channel_id: extractChannelIdentifier(card.channel_url),
          channel_title: card.channel_title
        });

        if (candidates.length >= maxCandidates) break;
      }

      if (candidates.length === beforeCount) {
        stagnantRounds += 1;
      } else {
        stagnantRounds = 0;
      }

      if (candidates.length >= maxCandidates) break;

      scrollRounds += 1;
      await page.mouse.wheel(0, 8000).catch(() => {});
      await page.waitForTimeout(1500);
    }

    return {
      candidates,
      pages_fetched: Math.max(1, scrollRounds + 1)
    };
  } finally {
    await session.cleanup().catch(() => {});
  }
}
