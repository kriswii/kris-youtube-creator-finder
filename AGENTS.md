# AGENTS.md

## Project Goal

Build a local YouTube Creator Pipeline for discovering small and mid-sized creators that are good outreach candidates for partnerships.

The system should prefer relative performance over absolute scale. It should help identify creators in the 3k-50k subscriber range whose recent videos overperform their channel size.

## Working Rules For Agents

- Work in phases. Do not implement every stage in one large change.
- Preserve the existing `collector-web` prototype unless a phase explicitly migrates or replaces it.
- Keep scoring logic deterministic and covered by unit tests.
- Compute `pre_score` before Playwright, Comet, or MiniMax stages.
- Treat the scoring formulas in this file as mandatory product rules. Do not change weights, thresholds, or tier boundaries without explicit user approval.
- Do not make absolute views the dominant ranking factor.
- Do not bypass protected email verification or reCAPTCHA. If gated, record status and use manual fallback.
- Do not require Comet automation to succeed. Always preserve a manual Comet summary fallback.
- Do not let MiniMax produce the final score. MiniMax only returns soft sub-scores and explanation; backend formula computes `final_score`.
- Prefer TypeScript, Zod validation, service-layer modules, SQLite persistence, Playwright for browser automation, and CSV/XLSX export.
- When adding or changing formulas, add or update tests in the same phase.
- When changing output fields, keep CSV/XLSX schemas explicit and documented.

## Existing Context

- Current local collector prototype: `collector-web/server.js`
- Current collector UI: `collector-web/public/index.html`
- Existing Comet summary experiments: `collector-web/scripts/test-comet-sidecar-simple.js`
- Existing channel contact crawl experiment: `collector-web/scripts/test-channel-contact.js`
- Legacy prototype pieces: `extension/` and `server/`

## Target Pipeline

```text
YouTube Data API search.list candidate scan
  -> videos.list video metrics enrichment
  -> channels.list channel metrics enrichment
  -> deterministic pre_score
  -> hard filtering and shortlist
  -> Playwright public contact scrape
  -> Comet Assistant summary, automated or manual fallback
  -> MiniMax soft analysis
  -> backend final_score
  -> CSV/XLSX export
  -> frontend results table and detail drawer
```

## Required Environment Variables

```text
YOUTUBE_API_KEY=
MINIMAX_API_KEY=
APP_BASE_URL=
DEFAULT_SUB_MIN=3000
DEFAULT_SUB_MAX=50000
DEFAULT_MAX_CANDIDATES=200
DEFAULT_LOOKBACK_DAYS=30
PLAYWRIGHT_HEADLESS=false
EXPORT_DIR=./data/exports
```

## Phase Checklist

1. Project docs and structure only.
2. Types, schemas, persistence, jobs/results model, API route skeleton.
3. YouTube ingestion using `search.list`, `videos.list`, and `channels.list`.
4. Scoring engine and unit tests.
5. Frontend search page, results table, and detail drawer.
6. Playwright public contact scraping.
7. Comet automated summary and manual fallback.
8. MiniMax integration and final score formula.
9. CSV/XLSX export.
10. Integration tests, README, and manual verification checklist.

## Mandatory Scoring Formulas

All scoring code must implement these formulas exactly.

### Derived Metrics

```text
days_since_publish = max(1, ceil((now - published_at) / 86400))
engagement_rate = (likes + comments * 2) / max(views, 1)
comment_rate = comments / max(views, 1)
view_sub_ratio = views / max(subscribers, 1)
relative_velocity = views / days_since_publish / max(subscribers, 1)
clamp(x, min, max) = max(min, min(x, max))
```

### Subscriber Fit

```text
if 3000 <= subscribers < 8000:
  sub_fit_score = 0.7
elif 8000 <= subscribers <= 30000:
  sub_fit_score = 1.0
elif 30000 < subscribers <= 50000:
  sub_fit_score = 0.8
elif 50000 < subscribers <= 100000:
  sub_fit_score = 0.5
else:
  sub_fit_score = 0
```

### Normalized Components

```text
view_sub_score = clamp(view_sub_ratio / 0.4, 0, 1)
engagement_score = clamp(engagement_rate / 0.05, 0, 1)
comment_score = clamp(comment_rate / 0.005, 0, 1)
relative_velocity_score = clamp(relative_velocity / 0.02, 0, 1)
```

### Pre Score

```text
pre_score =
  30 * sub_fit_score
  + 30 * view_sub_score
  + 20 * engagement_score
  + 10 * comment_score
  + 10 * relative_velocity_score
```

### Opportunity Tier

```text
pre_score >= 85 => A
pre_score >= 70 and < 85 => B
pre_score >= 55 and < 70 => C
pre_score < 55 => D
```

### Contactability Score

```text
public email => 100
social links only => 70
website/contact page only => 50
none => 0
```

### MiniMax Output Contract

MiniMax returns soft scores only. It must not compute final score.

```json
{
  "content_type": "...",
  "content_fit_score": 0,
  "audience_fit_score": 0,
  "brand_safety_score": 0,
  "commercial_intent_score": 0,
  "reason": "..."
}
```

### Final Score

```text
pre_score_norm = clamp(pre_score / 100, 0, 1)
contactability_norm = clamp(contactability_score / 100, 0, 1)
content_fit_norm = clamp(content_fit_score / 100, 0, 1)
audience_fit_norm = clamp(audience_fit_score / 100, 0, 1)
brand_safety_norm = clamp(brand_safety_score / 100, 0, 1)

final_score = 100 * (
  0.40 * pre_score_norm
  + 0.20 * contactability_norm
  + 0.20 * content_fit_norm
  + 0.10 * audience_fit_norm
  + 0.10 * brand_safety_norm
)
```

### Outreach Priority

```text
final_score >= 85 => P1
final_score >= 70 and < 85 => P2
final_score >= 55 and < 70 => P3
final_score < 55 => P4
```

## Planned SQLite Tables

Step 2 should define migrations for:

- `jobs`: one search/run configuration per keyword.
- `results`: one row per video candidate/result, including API metrics, derived metrics, scores, contact fields, summaries, MiniMax fields, final score, and status.
- `comet_summaries`: optional but recommended table for preserving Comet raw outputs and parse status independent of result rows.
- `exports`: export metadata, file paths, row counts, and status.

Required Step 2 additions:

- `jobs.config_json TEXT` to preserve the submitted config snapshot.
- `results.search_page INTEGER` and `results.search_source TEXT` to preserve candidate source metadata.
- `jobs.stage` and `results.status` must be TypeScript/Zod limited enums, not arbitrary strings.
- SQLite indexes must include `results(job_id)`, `results(job_id, pre_score DESC)`, `results(job_id, final_score DESC)`, `results(job_id, subscribers)`, and `results(job_id, published_at)`.

## Stage Acceptance Criteria

- Step 2: Types, Zod schemas, SQLite schema, jobs/results/comet_summaries/exports structures, and route skeleton compile and validate without calling external services.
- Step 3: Mockable YouTube ingestion stores candidates and fills video/channel API metrics.
- Step 4: Scoring unit tests prove formula weights, caps, tier mapping, and large-channel behavior.
- Step 5: Frontend can create/search jobs and display stored results with filters.
- Step 6: Contact scraper records only public information and gated states; it does not bypass verification.
- Step 7: Comet summary supports automated capture and manual paste fallback.
- Step 8: MiniMax parser validates JSON, retries once on invalid JSON, and final score remains backend-computed.
- Step 9: CSV/XLSX exports include explicit columns and open without Chinese garbling.
- Step 10: Integration tests and README/manual checklist cover the full local MVP flow.
