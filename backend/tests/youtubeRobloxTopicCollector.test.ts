import { describe, expect, it } from "vitest";
import { collectYouTubeRobloxSignals } from "../src/services/social/youtubeRobloxTopicCollector.js";
import type { YouTubeFetch } from "../src/services/youtube/youtubeService.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body
  } as Response;
}

function mockFetch(): YouTubeFetch {
  return async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.pathname.includes("/search")) {
      return jsonResponse({
        items: [
          {
            id: { kind: "youtube#video", videoId: "tips1" },
            snippet: {
              title: "Roblox Grow a Garden beginner tips for rare items",
              publishedAt: "2026-04-16T08:00:00.000Z",
              channelId: "c1",
              channelTitle: "Guide Creator"
            }
          },
          {
            id: { kind: "youtube#video", videoId: "code1" },
            snippet: {
              title: "Blox Fruits new codes today",
              publishedAt: "2026-04-16T08:00:00.000Z",
              channelId: "c2",
              channelTitle: "Code Creator"
            }
          },
          {
            id: { kind: "youtube#video", videoId: "meme1" },
            snippet: {
              title: "Roblox Dress To Impress best outfit tips",
              publishedAt: "2026-04-16T07:00:00.000Z",
              channelId: "c3",
              channelTitle: "Meme Creator"
            }
          },
          {
            id: { kind: "youtube#video", videoId: "short1" },
            snippet: {
              title: "HELP US DECIDE WHO WON #roblox #shorts",
              publishedAt: "2026-04-16T07:00:00.000Z",
              channelId: "c4",
              channelTitle: "Shorts Creator"
            }
          }
        ]
      });
    }

    expect(url.pathname).toContain("/videos");
    expect(url.searchParams.get("id")).toBe("tips1,meme1");
    return jsonResponse({
      items: [
        {
          id: "tips1",
          snippet: {
            title: "Roblox Grow a Garden beginner tips for rare items",
            publishedAt: "2026-04-16T08:00:00.000Z",
            channelId: "c1",
            channelTitle: "Guide Creator"
          },
          statistics: { viewCount: "100000", likeCount: "5000", commentCount: "300" }
        },
        {
          id: "meme1",
          snippet: {
            title: "Roblox Dress To Impress best outfit tips",
            publishedAt: "2026-04-16T07:00:00.000Z",
            channelId: "c3",
            channelTitle: "Meme Creator"
          },
          statistics: { viewCount: "40000", likeCount: "3000", commentCount: "500" }
        },
        {
          id: "short1",
          snippet: {
            title: "HELP US DECIDE WHO WON #roblox #shorts",
            publishedAt: "2026-04-16T07:00:00.000Z",
            channelId: "c4",
            channelTitle: "Shorts Creator"
          },
          statistics: { viewCount: "900000", likeCount: "30000", commentCount: "5000" }
        }
      ]
    });
  };
}

describe("youtube roblox topic collector", () => {
  it("collects YouTube videos as Roblox signals and excludes code content", async () => {
    const signals = await collectYouTubeRobloxSignals({
      apiKey: "test",
      queries: ["roblox tips"],
      lookbackDays: 7,
      maxPerQuery: 3,
      maxSignals: 10,
      now: new Date("2026-04-16T09:00:00.000Z"),
      fetchImpl: mockFetch()
    });

    expect(signals).toHaveLength(2);
    expect(signals.some((signal) => /code/i.test(signal.title))).toBe(false);
    expect(signals.some((signal) => /shorts/i.test(signal.title))).toBe(false);
    expect(signals.map((signal) => signal.kind)).toEqual(["guide_question", "guide_question"]);
    expect(signals[0]).toMatchObject({
      id: "yt-tips1",
      game: "Grow a Garden",
      source_type: "creator",
      source_url: "https://www.youtube.com/watch?v=tips1"
    });
  });
});
