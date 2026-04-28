# Architecture Plan for Full Product

## 1) Extension Layer

- Content script runs on `youtube.com/results`.
- Captures video cards and sends to backend.
- Shows filter controls + score badges.
- Applies local filtering instantly.

## 2) Scoring Backend

- Endpoint: `/enrich`
- Inputs: query + candidate videos
- Steps:
  1. Normalize candidate features
  2. Fetch extra metadata from YouTube API (optional at MVP)
  3. Apply ranking model
  4. Return score + explanation

## 3) Data Layer (Phase 2)

- Postgres tables:
  - `keyword_metrics`
  - `video_snapshots`
  - `channel_profiles`
- Redis caches:
  - `enrich:{query}:{hash(candidates)}`

## 4) Ranking Model (Phase 2)

- Features:
  - keyword-title overlap
  - view velocity
  - freshness
  - topic trend
  - estimated competition
- Output:
  - `opportunityScore (0-100)`
  - `competitionScore (0-100)`

## 5) Compliance and Stability

- Respect YouTube API Terms.
- Keep user auth tokens in backend only.
- Add fallback path when DOM parser fails.