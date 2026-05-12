# YouTube Creator Finder

A local-first YouTube creator discovery tool for finding game-related YouTube channels by keyword and country/region.

This fork has been iterated for practical KOL sourcing rather than generic creator scoring. The current product goal is:

- search game-related creators by keyword;
- support region-specific discovery such as PH / TH / VN / ID;
- keep weak-but-useful country evidence instead of over-filtering;
- dedupe to one row per channel;
- export clean Excel files that outreach teammates can use directly.

## What It Does

- Searches recent YouTube videos by keyword and resolves them to channel-level results.
- Validates keyword hits from:
  - title
  - video description
  - description hashtags
  - video tags
- Enriches channels with subscribers, views, country, language, avatar, and description.
- Uses layered country evidence:
  - channel "About / more info"
  - YouTube API country
  - metadata/text weak evidence
  - language as enhancement only
- Dedupe results by channel so one channel only appears once.
- When a country is selected, the UI only shows that country and blank-country rows.
- Exports deduped `.xlsx` files with one row per channel and country-aware filtering.
- Includes local keep-alive scripts for frontend, backend, and the dedicated search browser session.

## Current Runtime Pipeline

```text
keyword
  -> YouTube web search / local search browser
  -> keyword-hit validation (title / description / hashtags / tags)
  -> channel-level dedupe
  -> channel enrichment
  -> country evidence evaluation
  -> UI display filtering
  -> XLSX export
```

YouTube Data API is still used as an enrichment/data source, but the product is no longer documented as a pure API-first finder.

## Repository Structure

```text
backend/              Node.js + TypeScript backend, SQLite persistence, export, country logic
frontend/             React + TypeScript dashboard
cloudflare/           Cloudflare deployment notes and optional Worker proxy template
scripts/              Local startup, watchdog, and helper scripts
docs/                 Architecture and product notes
AGENTS.md             Product rules and historical design notes
.env.example          Environment variable template
```

## Requirements

- Node.js 22+
- npm
- YouTube Data API key
- Optional: Cloudflare account and `cloudflared` for team access

## Environment

Copy `.env.example` to `.env` in the project root or configure equivalent environment variables:

```text
YOUTUBE_API_KEY=
APP_BASE_URL=http://localhost:3000
DEFAULT_SUB_MIN=100
DEFAULT_SUB_MAX=5000000
DEFAULT_MAX_CANDIDATES=500
DEFAULT_LOOKBACK_DAYS=14
EXPORT_DIR=./data/exports
```

Do not commit `.env`, `.env.local`, SQLite databases, or export files.

## Local Backend

```powershell
cd "<repo>\backend"
npm install
npm run db:init
npm run typecheck
npm test
npm run dev
```

Default backend health check:

```text
http://localhost:3001/health
```

## Local Frontend

```powershell
cd "<repo>\frontend"
npm install
npm run typecheck
npm run build
npm run dev
```

For local development, `frontend/.env.local` can point to:

```env
VITE_API_BASE_URL=http://localhost:3001
```

## Local Startup Helpers

Start the fixed local stack:

```powershell
cd "<repo>"
.\scripts\start-local-with-tunnel.ps1
```

Optional keep-alive watcher:

```powershell
.\scripts\keep-local-services-alive.ps1
```

This watcher monitors:

- frontend preview
- backend API
- dedicated YouTube search browser session

and restarts them when they drop.

## Dedicated Search Browser

For the local web-search flow, keep the dedicated search browser running:

```powershell
.\scripts\start-youtube-search-browser.ps1
```

The dedicated browser is used for the more human-like local YouTube search path.

## Cloudflare Pages Deployment

Recommended no-domain setup:

```text
Cloudflare Pages fixed frontend
  -> Pages Function /api/* proxy
  -> current quick Tunnel URL
  -> local backend on http://localhost:3001
```

Pages settings:

```text
Root directory: frontend
Build command: npm run build
Output directory: dist
Environment variable: VITE_API_BASE_URL=/api
Secret: BACKEND_BASE_URL=https://your-current-tunnel.trycloudflare.com
```

See `cloudflare/README.md` for deployment details.

## API Flow

```powershell
$job = Invoke-RestMethod "http://localhost:3001/api/jobs" -Method Post -ContentType "application/json" -Body '{"keyword":"lordnine","channel_country":"PH"}'
Invoke-RestMethod "http://localhost:3001/api/jobs/$($job.job.id)/run-search" -Method Post
Invoke-RestMethod "http://localhost:3001/api/jobs/$($job.job.id)/run-enrichment" -Method Post
Invoke-RestMethod "http://localhost:3001/api/jobs/$($job.job.id)/run-pre-score" -Method Post
Invoke-RestMethod "http://localhost:3001/api/jobs/$($job.job.id)/run-shortlist" -Method Post
Invoke-RestMethod "http://localhost:3001/api/jobs/$($job.job.id)"
```

## Current Defaults

- `lookback_days`: `14`
- `subscriber_min`: `100`
- `subscriber_max`: `5,000,000`
- `max_candidates`: default UI value `500` and user-adjustable
- `shortlist_size`: fixed to `100` in the current runtime flow
- `minimum_pre_score`: default UI value `0`

Important:

- when a country is selected, UI results only show that country or blank-country rows;
- exports are deduped by channel;
- exports follow the current country selection logic.

## Export Rules

- one row per channel
- channel link preferred over duplicated video links
- if no country is selected, export all deduped results
- if a country is selected, export only that country's results
- output format is standard `.xlsx`

## Notes On Country Logic

The current implementation was originally tuned for Philippines discovery, then generalized so the same logic can be reused for TH / VN / ID / MY / SG / BR / KR / JP / TW / US without weakening PH behavior.

Country evidence remains layered:

- strongest: channel "About / more info"
- second: YouTube API country
- weak: metadata/text evidence
- language: enhancement only

When country evidence is weak, blank-country rows may still be shown because the workflow is designed to reduce false negatives, not aggressively hide useful candidates.

## Tests

Backend:

```powershell
cd backend
npm run typecheck
npm test
```

Frontend:

```powershell
cd frontend
npm run typecheck
npm run build
```

## License

MIT
