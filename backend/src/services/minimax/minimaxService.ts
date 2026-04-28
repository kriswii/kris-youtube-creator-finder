import { env } from "../../config/env.js";
import { minimaxAnalysisSchema } from "../../schemas/minimaxSchemas.js";
import type { MiniMaxAnalysis } from "../../types/minimax.js";

export interface MiniMaxInput {
  title: string | null;
  channel_title: string | null;
  views: number;
  likes: number;
  comments: number;
  subscribers: number;
  pre_score: number | null;
  public_email_found: boolean;
  social_links: string[];
  comet_video_summary: string | null;
  comet_comments_summary: string | null;
}

export interface MiniMaxRequestOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYSTEM_PROMPT = `You are an analyst scoring YouTube creator outreach candidates for a game-related brand.
Return valid JSON only.

All score fields must be numbers on a 0-100 scale.
Do not use a 0-10 scale.
Return integers whenever possible.

Required JSON fields:
- content_type
- content_fit_score
- audience_fit_score
- brand_safety_score
- commercial_intent_score
- reason`;

function normalizeMiniMaxScale(input: MiniMaxAnalysis): MiniMaxAnalysis {
  const scoreKeys = [
    "content_fit_score",
    "audience_fit_score",
    "brand_safety_score",
    "commercial_intent_score"
  ] as const;
  const values = scoreKeys.map((key) => input[key]);
  const looksLikeZeroToTenScale = values.every((value) => value >= 0 && value <= 10) && values.some((value) => value > 0);

  if (!looksLikeZeroToTenScale) {
    return input;
  }

  return {
    ...input,
    content_fit_score: input.content_fit_score * 10,
    audience_fit_score: input.audience_fit_score * 10,
    brand_safety_score: input.brand_safety_score * 10,
    commercial_intent_score: input.commercial_intent_score * 10
  };
}

function extractJsonBlock(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export function parseMiniMaxJson(raw: string): MiniMaxAnalysis {
  const parsed = JSON.parse(extractJsonBlock(raw));
  return minimaxAnalysisSchema.parse(normalizeMiniMaxScale(parsed));
}

function buildUserPrompt(input: MiniMaxInput): string {
  return JSON.stringify(
    {
      title: input.title,
      channel_title: input.channel_title,
      views: input.views,
      likes: input.likes,
      comments: input.comments,
      subscribers: input.subscribers,
      pre_score: input.pre_score,
      public_email_found: input.public_email_found,
      social_links: input.social_links,
      comet_video_summary: input.comet_video_summary,
      comet_comments_summary: input.comet_comments_summary
    },
    null,
    2
  );
}

async function callMiniMaxApi(input: MiniMaxInput, options: MiniMaxRequestOptions): Promise<string> {
  const apiKey = options.apiKey ?? env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("Missing MINIMAX_API_KEY");
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = env.MINIMAX_API_BASE_URL.replace(/\/$/, "");
  const endpoint = env.MINIMAX_API_TYPE === "anthropic-messages" ? `${baseUrl}/v1/messages` : baseUrl;

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.MINIMAX_MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildUserPrompt(input)
            }
          ]
        }
      ]
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`MiniMax request failed with status ${response.status}: ${responseText.slice(0, 400)}`);
  }

  const data = JSON.parse(responseText) as {
    error?: { message?: string };
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  };

  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const content = data.content
    ?.filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!content) {
    throw new Error(`MiniMax returned an empty response. Raw: ${responseText.slice(0, 400)}`);
  }
  return content;
}

export async function requestMiniMaxAnalysis(
  input: MiniMaxInput,
  options: MiniMaxRequestOptions = {}
): Promise<{ analysis: MiniMaxAnalysis; raw: string; attempts: number }> {
  let lastError: unknown;
  let lastRaw = "";

  for (let attempts = 1; attempts <= 2; attempts += 1) {
    try {
      lastRaw = await callMiniMaxApi(input, options);
      return {
        analysis: parseMiniMaxJson(lastRaw),
        raw: lastRaw,
        attempts
      };
    } catch (error) {
      lastError = error;
      if (attempts < 2) {
        await sleep(1200);
      }
    }
  }

  throw new Error(
    lastError instanceof Error ? lastError.message : "MiniMax failed after retrying invalid JSON once."
  );
}
