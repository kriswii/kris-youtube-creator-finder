# Roblox Content Topic System

This document defines the first MVP for deciding what a Roblox Facebook page should post today.

## Goal

Generate a daily ranked list of Roblox post ideas from observed signals, then produce safe draft copy for Facebook and X. Publishing automation is deliberately separate; this system answers "what should we post today?"

## MVP Flow

```text
Collect source signals
  -> validate and normalize
  -> remove redeem-code/code/free-Robux content
  -> score topic candidates
  -> block unsafe themes
  -> output top pick and candidate pool
  -> send selected draft to Postiz, n8n, or browser RPA later
```

## Signal Sources To Add

- Roblox game trend pages and game detail pages for current popular experiences.
- YouTube search/RSS results for Roblox game names plus "tips", "codes", "guide", and "funny moments".
- Reddit/X/TikTok/community posts for repeated questions and memes.
- Official game X accounts, Discord announcement channels, Roblox groups, and wiki pages for redeem codes.
- Internal commerce and FAQ data for safe buying education.

The current business rule is to exclude code/redeem-code/free-code content from publishing candidates. Hard-risk themes such as free Robux, account trading, off-platform currency sales, and minor-targeted sales are also excluded from CLI output. These sources can still be tracked later for market intelligence, but they should not create post ideas.

## Scoring

The MVP uses deterministic scoring:

```text
topic_score =
  30% demand
  + 25% business fit
  + 20% trust
  + 15% interaction potential
  + 10% freshness
  - risk penalty
```

Actions:

- `publish`: score is at least 75 and no risk flags.
- `review`: score is at least 55 or the topic needs verification.
- `skip`: low score or hard safety risk.

Hard skip flags include free Robux claims, account trading, off-platform currency sales, and minor-targeting concerns.

## Guardrails

- Do not promise free Robux or guaranteed working codes.
- Do not promote account trading, black-market currency, exploits, scripts, or bypasses.
- Only mention redeem codes when the source is recorded and the post says codes can expire.
- Prefer tips, guides, memes, polls, and safety education over direct sales language.
- Use original meme copy or licensed/owned visuals instead of reposting other creators' images.

## Local Use

Run the seed demo:

```powershell
cd "C:\Users\ug1ra\Documents\New project\backend"
npm run roblox:today -- --source=seed
```

Run with YouTube Data API signals:

```powershell
cd "C:\Users\ug1ra\Documents\New project\backend"
npm run roblox:today -- --source=youtube --lookback=7 --max=8
```

Run with custom normalized signals:

```powershell
npm run roblox:today -- --input="C:\path\to\signals.json" --format=json
```

The custom JSON shape is:

```json
{
  "brand": "Roblox items page",
  "audience": "Roblox players who like tips, codes, memes, and safe item buying",
  "now": "2026-04-16T09:00:00.000Z",
  "max_candidates": 10,
  "signals": [
    {
      "id": "example",
      "kind": "guide_question",
      "source_type": "creator",
      "title": "Best beginner route for a popular Roblox game",
      "game": "Example Game",
      "observed_at": "2026-04-16T08:00:00.000Z",
      "engagement_count": 1000,
      "business_fit": 80,
      "interaction_potential": 85,
      "reliability": 75,
      "tags": ["roblox", "guide"],
      "risk_flags": []
    }
  ]
}
```
