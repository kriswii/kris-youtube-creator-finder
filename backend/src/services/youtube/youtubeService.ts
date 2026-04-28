export interface YouTubeFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface SearchCandidatesInput {
  apiKey: string;
  keyword: string;
  lookbackDays: number;
  maxCandidates?: number;
  maxPages?: number;
  now?: Date;
  fetchImpl?: YouTubeFetch;
}

export interface SearchCandidatesResult {
  candidates: YouTubeSearchCandidate[];
  pages_fetched: number;
}

export interface YouTubeSearchCandidate {
  video_id: string;
  video_url: string;
  title: string;
  published_at: string;
  raw_search_rank: number;
  search_page: number;
  search_source: "youtube_api_search";
  channel_id: string;
  channel_title: string;
}

export interface YouTubeVideoMetric {
  video_id: string;
  title: string;
  published_at: string;
  views: number;
  likes: number;
  comments: number;
  channel_id: string;
  channel_title: string;
}

export interface YouTubeChannelMetric {
  channel_id: string;
  channel_title: string;
  channel_description: string;
  subscribers: number;
  channel_avatar_url: string;
  channel_country: string;
}

export interface EnrichVideoMetricsResult {
  metrics: YouTubeVideoMetric[];
  requests_made: number;
}

export interface EnrichChannelMetricsResult {
  metrics: YouTubeChannelMetric[];
  requests_made: number;
}

interface YouTubeApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export class YouTubeApiError extends Error {
  readonly statusCode: number;
  readonly apiStatus?: string;

  constructor(message: string, statusCode: number, apiStatus?: string) {
    super(message);
    this.name = "YouTubeApiError";
    this.statusCode = statusCode;
    this.apiStatus = apiStatus;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function publishedAfterForLookback(lookbackDays: number, now = new Date()): string {
  const days = Math.max(1, Math.trunc(lookbackDays));
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

async function parseApiError(response: Response): Promise<YouTubeApiError> {
  let body: YouTubeApiErrorBody = {};
  try {
    body = (await response.json()) as YouTubeApiErrorBody;
  } catch {
    // Keep default body when YouTube returns non-JSON errors.
  }
  const message = body.error?.message || response.statusText || "YouTube API request failed";
  return new YouTubeApiError(message, response.status, body.error?.status);
}

async function youtubeGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  apiKey: string,
  fetchImpl: YouTubeFetch = fetch
): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("key", apiKey);

  const response = await fetchImpl(url);
  if (!response.ok) throw await parseApiError(response);
  return (await response.json()) as T;
}

export async function searchCandidates(input: SearchCandidatesInput): Promise<SearchCandidatesResult> {
  const fetchImpl = input.fetchImpl || fetch;
  const maxCandidates = Math.max(1, input.maxCandidates ?? 200);
  const maxPages = Math.max(1, input.maxPages ?? Math.ceil(maxCandidates / 50));
  const publishedAfter = publishedAfterForLookback(input.lookbackDays, input.now);
  const candidates: YouTubeSearchCandidate[] = [];
  const seen = new Set<string>();
  let nextPageToken = "";
  let rawRank = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages && candidates.length < maxCandidates; page += 1) {
    const data = await youtubeGet<{
      nextPageToken?: string;
      items?: Array<{
        id?: { kind?: string; videoId?: string };
        snippet?: {
          title?: string;
          publishedAt?: string;
          channelId?: string;
          channelTitle?: string;
        };
      }>;
    }>(
      "search",
      {
        part: "snippet",
        q: input.keyword,
        type: "video",
        order: "relevance",
        maxResults: Math.min(50, maxCandidates - candidates.length),
        publishedAfter,
        pageToken: nextPageToken
      },
      input.apiKey,
      fetchImpl
    );
    pagesFetched += 1;

    for (const item of data.items || []) {
      const videoId = item.id?.videoId || "";
      if (!videoId || item.id?.kind !== "youtube#video" || seen.has(videoId)) continue;
      seen.add(videoId);
      rawRank += 1;
      const snippet = item.snippet || {};
      candidates.push({
        video_id: videoId,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        title: snippet.title || "",
        published_at: snippet.publishedAt || "",
        raw_search_rank: rawRank,
        search_page: page,
        search_source: "youtube_api_search",
        channel_id: snippet.channelId || "",
        channel_title: snippet.channelTitle || ""
      });
      if (candidates.length >= maxCandidates) break;
    }

    nextPageToken = data.nextPageToken || "";
    if (!nextPageToken) break;
  }

  return { candidates, pages_fetched: pagesFetched };
}

export async function enrichVideoMetrics(
  apiKey: string,
  videoIds: string[],
  fetchImpl: YouTubeFetch = fetch
): Promise<EnrichVideoMetricsResult> {
  const out: YouTubeVideoMetric[] = [];
  let requestsMade = 0;
  for (const ids of chunk(unique(videoIds), 50)) {
    if (!ids.length) continue;
    const data = await youtubeGet<{
      items?: Array<{
        id?: string;
        snippet?: {
          title?: string;
          publishedAt?: string;
          channelId?: string;
          channelTitle?: string;
        };
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }>;
    }>(
      "videos",
      {
        part: "snippet,statistics",
        id: ids.join(","),
        maxResults: 50
      },
      apiKey,
      fetchImpl
    );
    requestsMade += 1;

    for (const item of data.items || []) {
      const videoId = item.id || "";
      if (!videoId) continue;
      const snippet = item.snippet || {};
      const stats = item.statistics || {};
      out.push({
        video_id: videoId,
        title: snippet.title || "",
        published_at: snippet.publishedAt || "",
        views: toInt(stats.viewCount),
        likes: toInt(stats.likeCount),
        comments: toInt(stats.commentCount),
        channel_id: snippet.channelId || "",
        channel_title: snippet.channelTitle || ""
      });
    }
  }
  return { metrics: out, requests_made: requestsMade };
}

export async function enrichChannelMetrics(
  apiKey: string,
  channelIds: string[],
  fetchImpl: YouTubeFetch = fetch
): Promise<EnrichChannelMetricsResult> {
  const out: YouTubeChannelMetric[] = [];
  let requestsMade = 0;
  for (const ids of chunk(unique(channelIds), 50)) {
    if (!ids.length) continue;
    const data = await youtubeGet<{
        items?: Array<{
          id?: string;
          snippet?: {
            title?: string;
            description?: string;
            country?: string;
            thumbnails?: {
              default?: { url?: string };
              medium?: { url?: string };
              high?: { url?: string };
            };
          };
          statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
        }>;
    }>(
      "channels",
      {
        part: "snippet,statistics",
        id: ids.join(","),
        maxResults: 50
      },
      apiKey,
      fetchImpl
    );
    requestsMade += 1;

    for (const item of data.items || []) {
      const channelId = item.id || "";
      if (!channelId) continue;
      const thumbnails = item.snippet?.thumbnails;
      out.push({
        channel_id: channelId,
        channel_title: item.snippet?.title || "",
        channel_description: item.snippet?.description || "",
        subscribers: item.statistics?.hiddenSubscriberCount ? 0 : toInt(item.statistics?.subscriberCount),
        channel_avatar_url: thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url || "",
        channel_country: item.snippet?.country || ""
      });
    }
  }
  return { metrics: out, requests_made: requestsMade };
}
