import { z } from "zod";
import { loadDotEnvFiles } from "./dotenv.js";

loadDotEnvFiles();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_PATH: z.string().default("./data/creator-pipeline.sqlite"),
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_DAILY_QUOTA_LIMIT: z.coerce.number().int().positive().default(10000),
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_API_BASE_URL: z.string().url().default("https://api.minimaxi.com/anthropic"),
  MINIMAX_API_TYPE: z.enum(["anthropic-messages"]).default("anthropic-messages"),
  MINIMAX_MODEL: z.string().default("MiniMax-M2.7"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  BROWSER_CDP_URL: z.string().default("http://127.0.0.1:9333"),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),
  COMET_CDP_URL: z.string().default("http://127.0.0.1:9333"),
  DEFAULT_SUB_MIN: z.coerce.number().int().nonnegative().default(3000),
  DEFAULT_SUB_MAX: z.coerce.number().int().nonnegative().default(50000),
  DEFAULT_MAX_CANDIDATES: z.coerce.number().int().positive().default(200),
  DEFAULT_LOOKBACK_DAYS: z.coerce.number().int().positive().default(30),
  PLAYWRIGHT_HEADLESS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EXPORT_DIR: z.string().default("./data/exports")
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(input);
}

export const env = loadEnv();
