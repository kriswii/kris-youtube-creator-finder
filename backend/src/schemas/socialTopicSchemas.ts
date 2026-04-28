import { z } from "zod";

export const socialPlatformSchema = z.enum(["facebook", "x", "instagram", "tiktok"]);

export const robloxSignalKindSchema = z.enum([
  "game_trend",
  "guide_question",
  "redeem_code",
  "meme",
  "safety",
  "commerce"
]);

export const robloxSourceTypeSchema = z.enum([
  "official",
  "creator",
  "community",
  "search_trend",
  "internal"
]);

export const topicRiskFlagSchema = z.enum([
  "free_robux_claim",
  "account_trading",
  "unverified_code",
  "off_platform_currency_sale",
  "copyright_repost",
  "minor_targeting"
]);

export const robloxContentSignalSchema = z.object({
  id: z.string().min(1),
  kind: robloxSignalKindSchema,
  source_type: robloxSourceTypeSchema,
  title: z.string().min(3),
  game: z.string().min(1).optional(),
  source_url: z.string().url().optional(),
  observed_at: z.string().datetime(),
  engagement_count: z.number().int().nonnegative(),
  business_fit: z.number().min(0).max(100),
  interaction_potential: z.number().min(0).max(100),
  reliability: z.number().min(0).max(100),
  tags: z.array(z.string().min(1)).default([]),
  risk_flags: z.array(topicRiskFlagSchema).default([]),
  notes: z.string().optional()
});

export const robloxTopicInputSchema = z.object({
  brand: z.string().min(1).default("Roblox items page"),
  audience: z.string().min(1).default("Roblox players who like game tips, codes, memes, and safe item buying"),
  now: z.string().datetime().optional(),
  max_candidates: z.number().int().positive().max(20).default(10),
  signals: z.array(robloxContentSignalSchema).min(1)
});

export type RobloxTopicInput = z.infer<typeof robloxTopicInputSchema>;
