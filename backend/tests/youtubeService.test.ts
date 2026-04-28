import { describe, expect, it } from "vitest";
import {
  enrichChannelMetrics,
  enrichVideoMetrics,
  searchCandidates,
  type YouTubeFetch
} from "../src/services/youtube/youtubeService.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body
  } as Response;
}

function mockFetch(handler: (url: URL) => unknown): YouTubeFetch {
  return async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    return jsonResponse(handler(url));
  };
}

describe("youtubeService", () => {
  it("search.list returns deduped video candidates with rank and page metadata", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.pathname).toContain("/search");
      expect(url.searchParams.get("type")).toBe("video");
      expect(url.searchParams.get("publishedAfter")).toBeTruthy();
      return {
        items: [
          {
            id: { kind: "youtube#video", videoId: "v1" },
            snippet: {
              title: "Video 1",
              publishedAt: "2026-04-10T00:00:00.000Z",
              channelId: "c1",
              channelTitle: "Creator 1"
            }
          },
          {
            id: { kind: "youtube#channel", channelId: "not-video" },
            snippet: { title: "Ignore" }
          },
          {
            id: { kind: "youtube#video", videoId: "v1" },
            snippet: { title: "Duplicate" }
          },
          {
            id: { kind: "youtube#video", videoId: "v2" },
            snippet: {
              title: "Video 2",
              publishedAt: "2026-04-11T00:00:00.000Z",
              channelId: "c2",
              channelTitle: "Creator 2"
            }
          }
        ]
      };
    });

    const result = await searchCandidates({
      apiKey: "test",
      keyword: "phone",
      lookbackDays: 30,
      maxCandidates: 10,
      maxPages: 1,
      now: new Date("2026-04-14T00:00:00.000Z"),
      fetchImpl
    });

    const rows = result.candidates;
    expect(rows).toHaveLength(2);
    expect(result.pages_fetched).toBe(1);
    expect(rows[0]).toMatchObject({
      video_id: "v1",
      raw_search_rank: 1,
      search_page: 1,
      search_source: "youtube_api_search"
    });
    expect(rows[1]?.raw_search_rank).toBe(2);
  });

  it("videos.list enriches metrics and tolerates missing statistics", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.pathname).toContain("/videos");
      expect(url.searchParams.get("id")).toBe("v1,v2");
      return {
        items: [
          {
            id: "v1",
            snippet: {
              title: "Full title",
              publishedAt: "2026-04-10T00:00:00.000Z",
              channelId: "c1",
              channelTitle: "Creator 1"
            },
            statistics: {
              viewCount: "10000",
              likeCount: "500",
              commentCount: "120"
            }
          },
          {
            id: "v2",
            snippet: {
              title: "Missing stats",
              channelId: "c2",
              channelTitle: "Creator 2"
            }
          }
        ]
      };
    });

    const result = await enrichVideoMetrics("test", ["v1", "v2"], fetchImpl);
    const rows = result.metrics;
    expect(rows[0]).toMatchObject({ video_id: "v1", views: 10000, likes: 500, comments: 120 });
    expect(rows[1]).toMatchObject({ video_id: "v2", views: 0, likes: 0, comments: 0 });
    expect(result.requests_made).toBe(1);
  });

  it("channels.list enriches subscriber counts and tolerates hidden subscribers", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.pathname).toContain("/channels");
      expect(url.searchParams.get("id")).toBe("c1,c2");
      return {
        items: [
          {
            id: "c1",
            snippet: {
              title: "Creator 1",
              thumbnails: {
                high: { url: "https://example.com/c1-high.jpg" }
              }
            },
            statistics: { subscriberCount: "12345" }
          },
          {
            id: "c2",
            snippet: {
              title: "Creator 2",
              thumbnails: {
                default: { url: "https://example.com/c2-default.jpg" }
              }
            },
            statistics: { hiddenSubscriberCount: true }
          }
        ]
      };
    });

    const result = await enrichChannelMetrics("test", ["c1", "c2"], fetchImpl);
    const rows = result.metrics;
    expect(rows[0]).toMatchObject({
      channel_id: "c1",
      subscribers: 12345,
      channel_avatar_url: "https://example.com/c1-high.jpg",
      channel_country: ""
    });
    expect(rows[1]).toMatchObject({
      channel_id: "c2",
      subscribers: 0,
      channel_avatar_url: "https://example.com/c2-default.jpg",
      channel_country: ""
    });
    expect(result.requests_made).toBe(1);
  });
});
