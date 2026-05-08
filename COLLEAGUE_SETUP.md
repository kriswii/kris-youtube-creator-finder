# Kris YouTube Creator Finder - Colleague Setup

This package is the current customized version of the YouTube Finder used for Philippines-focused creator discovery.

## What is customized in this version

- Search is centered on the keyword you enter. It does not auto-expand your keyword.
- Keyword matching accepts hits from:
  - video title
  - video description body
  - hashtags in the description
  - video tags
- In `PH` mode, the UI only shows channels whose country is:
  - `PH`
  - blank / unknown
- Repeated videos from the same channel are merged into one channel result in the UI.
- Channel homepage/about scraping is deduplicated so the same channel is not opened repeatedly.
- Current default behavior:
  - lookback window fixed to 14 days
  - shortlist display target fixed to about 50 channels
  - max subscribers fixed to 500000
  - max candidates is editable in the UI

## Requirements

- Windows
- Node.js 22+ with npm
- A YouTube Data API key
- Google Chrome

## Files you need to configure

Copy `.env.example` to `.env` in the repo root and set:

```env
YOUTUBE_API_KEY=your_key_here
APP_BASE_URL=http://localhost:3000
DEFAULT_SUB_MIN=100
DEFAULT_SUB_MAX=500000
DEFAULT_MAX_CANDIDATES=500
DEFAULT_LOOKBACK_DAYS=14
EXPORT_DIR=./data/exports
```

## Important note about search mode

This build has moved closer to human-like YouTube search behavior.

To make that work reliably, keep a Chrome window running with remote debugging on port `9333`. A helper script is included:

```powershell
.\scripts\start-youtube-search-browser.ps1
```

That opens a Chrome window that the backend can connect to for search tasks.

## Optional watchdog

If you want the local stack to auto-heal when frontend, backend, or the search browser drops, run:

```powershell
.\scripts\keep-local-services-alive.ps1
```

It watches:

- frontend preview on `4173`
- backend on `3001`
- Chrome remote debugging on `9333`

and will restart missing parts automatically.

## Local startup

### 1. Start the search browser

```powershell
cd .\kris-youtube-creator-finder
.\scripts\start-youtube-search-browser.ps1
```

### 2. Start backend

```powershell
cd .\backend
npm install
npm run dev
```

Backend health should be available at:

```text
http://localhost:3001/health
```

### 3. Start frontend

In a second terminal:

```powershell
cd .\frontend
npm install
npm run dev
```

Open the local URL shown by Vite. It is usually:

```text
http://127.0.0.1:4173
```

## Recommended first test

1. Keep the Chrome search browser open.
2. Open the frontend.
3. Search a narrow game keyword, for example:
   - `night crows`
   - `blox fruits`
   - `lordnine`
4. Set country to `PH` if you want Philippines-focused filtering.

## If the UI says "Could not connect to your logged-in Chrome session"

Run:

```powershell
.\scripts\start-youtube-search-browser.ps1
```

Again, then retry the search.

## Notes for Codex users

If your colleague uses Codex, they can open this folder and ask Codex to:

- install dependencies
- start backend
- start frontend
- restart the search browser if port `9333` drops

## What this package is for

This build is optimized to help surface likely Philippines creators faster with less aggressive filtering. It is intentionally designed to show weaker-but-possibly-useful results instead of over-pruning them.
