import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { robloxTopicInputSchema, type RobloxTopicInput } from "../schemas/socialTopicSchemas.js";
import { collectYouTubeRobloxSignals } from "../services/social/youtubeRobloxTopicCollector.js";
import { buildSeedRobloxSignals } from "../services/social/robloxSeedSignals.js";
import { buildRobloxTopicReport } from "../services/social/robloxTopicEngine.js";
import type { RobloxContentSignal } from "../types/socialTopic.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function loadInput(): Promise<RobloxTopicInput> {
  const inputPath = argValue("input");
  const source = argValue("source") || "auto";
  const maxCandidates = Number(argValue("max") || 8);
  if (!inputPath) {
    const now = new Date();
    if ((source === "auto" || source === "youtube") && env.YOUTUBE_API_KEY) {
      const queryArg = argValue("queries");
      const queries = queryArg ? queryArg.split(",").map((query) => query.trim()).filter(Boolean) : undefined;
      const signals = await collectYouTubeRobloxSignals({
        apiKey: env.YOUTUBE_API_KEY,
        queries,
        lookbackDays: Number(argValue("lookback") || 7),
        maxPerQuery: Number(argValue("per-query") || 8),
        maxSignals: Math.max(10, maxCandidates * 3),
        now
      });

      return robloxTopicInputSchema.parse({
        brand: "Roblox items page",
        audience: "Roblox players who like tips, memes, game updates, and safe item buying",
        now: now.toISOString(),
        max_candidates: maxCandidates,
        signals
      });
    }

    if (source === "youtube" && !env.YOUTUBE_API_KEY) {
      throw new Error("Missing YOUTUBE_API_KEY. Add it to backend/.env, project .env, or your shell environment.");
    }

    return robloxTopicInputSchema.parse({
      brand: "Roblox items page",
      audience: "Roblox players who like tips, codes, memes, and safe item buying",
      now: now.toISOString(),
      max_candidates: maxCandidates,
      signals: buildSeedRobloxSignals(now)
    });
  }

  const raw = await readFile(inputPath, "utf8");
  return robloxTopicInputSchema.parse(JSON.parse(raw));
}

function isPostCandidateSignal(signal: RobloxContentSignal): boolean {
  if (signal.kind === "redeem_code") return false;
  return !signal.risk_flags.some((flag) =>
    ["free_robux_claim", "account_trading", "off_platform_currency_sale", "minor_targeting"].includes(flag)
  );
}

function printMarkdown(report: ReturnType<typeof buildRobloxTopicReport>): void {
  console.log(`# Today Roblox Post Ideas`);
  console.log("");
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Brand: ${report.brand}`);
  console.log("");

  if (report.top_pick) {
    console.log(`## Top Pick`);
    console.log("");
    console.log(`- Topic: ${report.top_pick.title}`);
    console.log(`- Game: ${report.top_pick.game || "Roblox"}`);
    console.log(`- Score: ${report.top_pick.score}`);
    console.log(`- Action: ${report.top_pick.action}`);
    console.log(`- Risk: ${report.top_pick.risk_level}`);
    console.log("");
    console.log(report.top_pick.draft.facebook_text);
    console.log("");
  }

  console.log(`## Candidate Pool`);
  console.log("");
  for (const candidate of report.candidates) {
    console.log(`### ${candidate.score} - ${candidate.title}`);
    console.log("");
    console.log(`Action: ${candidate.action} | Risk: ${candidate.risk_level} | Type: ${candidate.post_type}`);
    console.log(`Angle: ${candidate.angle}`);
    console.log("");
  }

  console.log(`## Guardrails`);
  console.log("");
  for (const guardrail of report.guardrails) console.log(`- ${guardrail}`);
}

const input = await loadInput();
const report = buildRobloxTopicReport({
  brand: input.brand,
  audience: input.audience,
  signals: input.signals.filter(isPostCandidateSignal),
  now: input.now ? new Date(input.now) : undefined,
  maxCandidates: input.max_candidates
});

if (argValue("format") === "json") {
  console.log(JSON.stringify(report, null, 2));
} else {
  printMarkdown(report);
}
