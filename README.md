# YouTube Creator Finder

A local-first YouTube creator discovery tool for finding small and mid-sized channels whose recent videos overperform their subscriber base.

The project is designed for partnership and outreach research. It favors relative performance signals such as view/subscriber ratio, engagement rate, comment rate, and relative velocity instead of ranking creators by absolute views alone.

## What It Does

- Searches recent YouTube videos by keyword through the YouTube Data API.
- Enriches videos with views, likes, comments, channel title, subscribers, channel country, and channel avatar.
- Computes deterministic `pre_score` using fixed formulas documented in `AGENTS.md`.
- Filters and shortlists promising creators in the default 3k-50k subscriber range.
- Shows a polished Chinese dashboard with sortable results, filters, metric explanations, and detail panel.
- Exports shortlisted results to XLSX.
- Can be deployed as a fixed Cloudflare Pages frontend that proxies to a local backend through Cloudflare Tunnel.

## Current Stable Pipeline

```text
keyword
  -> YouTube search.list
  -> videos.list metrics
  -> channels.list metrics
  -> deterministic pre_score
  -> shortlist
  -> dashboard
  -> XLSX export
```

Contact scraping, Comet automation, and MiniMax analysis are not part of the current stable UI flow.

## Repository Structure

```text
backend/              Node.js + TypeScript backend, SQLite persistence, scoring, export
frontend/             React + TypeScript dashboard and Cloudflare Pages Functions
cloudflare/           Cloudflare deployment notes and optional Worker proxy template
scripts/              Local startup and tunnel automation scripts
docs/                 Architecture and product notes
AGENTS.md             Product rules and mandatory scoring formulas
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
DEFAULT_SUB_MIN=3000
DEFAULT_SUB_MAX=50000
DEFAULT_MAX_CANDIDATES=200
DEFAULT_LOOKBACK_DAYS=30
EXPORT_DIR=./data/exports
```

Do not commit `.env`, `.env.local`, SQLite databases, or export files.

## Local Backend

```powershell
cd "C:\Users\ug1ra\Documents\New project\backend"
npm install
npm run db:init
npm run typecheck
npm test
npm run dev
```

Default backend health check:

```text
http://localhost:3011/health
```

## Local Frontend

```powershell
cd "C:\Users\ug1ra\Documents\New project\frontend"
npm install
npm run typecheck
npm run build
npm run dev
```

Open the Vite `Local:` URL shown in the terminal.

For local development, `frontend/.env.local` can point to:

```env
VITE_API_BASE_URL=http://localhost:3011
```

## One-Click Local Startup

Windows helper:

```text
C:\Users\ug1ra\Desktop\启动YouTube潜力股挖掘.bat
```

Repository script:

```powershell
cd "C:\Users\ug1ra\Documents\New project"
.\scripts\start-local-with-tunnel.ps1
```

The script starts the backend, starts a Cloudflare quick Tunnel, captures the generated `trycloudflare.com` URL, writes it to `frontend/.env.local`, and starts the frontend.

If the Cloudflare Pages project exists:

```powershell
.\scripts\start-local-with-tunnel.ps1 -UpdatePagesSecret -PagesProjectName youtube-finder
```

This updates the Pages `BACKEND_BASE_URL` secret so the fixed public frontend can keep proxying to the newest local Tunnel URL.

## Cloudflare Pages Deployment

Recommended no-domain setup:

```text
Cloudflare Pages fixed frontend
  -> Pages Function /api/* proxy
  -> current quick Tunnel URL
  -> local backend on http://localhost:3011
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
$job = Invoke-RestMethod "http://localhost:3011/api/jobs" -Method Post -ContentType "application/json" -Body '{"keyword":"iphone accessories","lookback_days":30,"subscriber_min":3000,"subscriber_max":50000,"max_candidates":20,"shortlist_size":10,"minimum_pre_score":55}'
Invoke-RestMethod "http://localhost:3011/api/jobs/$($job.job.id)/run-search" -Method Post
Invoke-RestMethod "http://localhost:3011/api/jobs/$($job.job.id)/run-enrichment" -Method Post
Invoke-RestMethod "http://localhost:3011/api/jobs/$($job.job.id)/run-pre-score" -Method Post
Invoke-RestMethod "http://localhost:3011/api/jobs/$($job.job.id)/run-shortlist" -Method Post
Invoke-RestMethod "http://localhost:3011/api/jobs/$($job.job.id)"
```

## Shortlist Defaults

- Subscribers between `subscriber_min` and `subscriber_max`, default 3,000-50,000.
- Published within `lookback_days`, default 30 days.
- Views at least 3,000.
- `pre_score >= minimum_pre_score`, default 55.
- Sorted by `pre_score DESC`.
- Limited to `shortlist_size`.

## Scoring

Scoring formulas are mandatory product rules and live in `AGENTS.md`.

Important principles:

- Do not let absolute views dominate ranking.
- Prefer creators whose videos overperform relative to their subscriber count.
- Keep formula changes covered by tests.

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
