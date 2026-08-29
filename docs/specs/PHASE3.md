# Phase 3 spec — Rank Tracking (+ jobs infra + Projects)

Conventions from docs/specs/PHASE1.md carry over (scoping, guards, wrappers, doc-verification, cost UX). This phase makes three things real: the cron/jobs machinery (currently a stub), the Projects concept, and daily rank checks.

## Projects (first-class from here on)

`projects` table already exists. Add `routes/projects.ts`: GET / (list for workspace), POST / {name, domain, locationCode, languageCode}, PATCH /:id, DELETE /:id (cascade covers children). Domain normalized like domains routes. Role: `member` to read, `admin` to create/delete. Shared types in src/shared/projects.ts. UI: a reusable `components/projects/project-picker.tsx` — select with inline "New project" dialog — used by every PROJECTS-group module; a module with no project selected renders the picker as its empty state.

## Jobs infra (harden `sweepJobs`, no schema change)

- Sweep every cron tick (*/5): claim due jobs with `UPDATE jobs SET status='running', run_at = now + 15min, attempts = attempts + 1 WHERE id IN (SELECT id FROM jobs WHERE (status='pending' AND run_at <= now) OR (status='running' AND run_at <= now) ORDER BY run_at LIMIT 10) RETURNING *` — `run_at` doubles as the lease deadline while running, so a crashed run self-retries when the lease lapses. D1 supports RETURNING.
- Handler registry: `src/worker/jobs/<type>.ts`, dispatched by `type`; success → status `done`; thrown error → `last_error` set and either back to `pending` with backoff `run_at = now + 5min * 2^attempts` or `failed` once attempts ≥ 5.
- Daily seeding: a `seed_daily` singleton job (re-enqueues itself for the next 03:00 UTC) that, per workspace with tracked keywords, enqueues `rank_post` jobs. Guard against duplicates by checking for an existing pending/running seed job before inserting.
- Jobs carry `workspace_id` whenever they touch tenant data (cascade rule).

## Rank checking (SERP task queue, not live)

- Use SERP API **standard-queue task flow** (cheapest): `serp/google/organic/task_post` in batches ≤ 100 tasks (one task per tracked keyword: keyword, location_code, language_code, device, depth 100, `tag` = tracked_keyword id), then a `rank_collect` job polls `tasks_ready` and fetches `task_get/regular/<id>` for finished ones (re-enqueue itself with backoff until all collected or 24h passes). Verify current paths/prices in the docs; task_post bills at post time (metered via the client as usual — spend caps therefore gate posting), task_get is free.
- Wrappers in `dataforseo/serp.ts` following existing patterns. The client already supports method/ttl; task flows are `ttl: "none"` (results are persisted to D1, not KV).
- Snapshot writing: for each result, find the project domain's best organic position (match root domain + subdomains; www-insensitive), write to `rank_snapshots` (one row per keyword per day — add a migration for a UNIQUE index on (tracked_keyword_id, date) and upsert on conflict, replacing Phase 0's deliberate deferral).
- `tracked_keywords` CRUD under `/api/v1/projects/:id/keywords`: GET (joined with latest + previous snapshots and 30-day series), POST bulk {keywords[], device, locationCode?, languageCode?} (defaults from project; dedupe on the unique index), DELETE bulk. On POST, immediately enqueue a `rank_post` for the new keywords so first data arrives within minutes, not tomorrow.
- `POST /api/v1/projects/:id/keywords/check-now` (admin): re-enqueue rank_post for all the project's keywords, rate-limited to once per hour per project.

## UI — Rank Tracking (`/app/rank-tracking`)

Project picker empty-state → tracking view:
- Header: project name/domain, "last checked" timestamp, keyword count, Check now button (admin, with cost hint ≈ $0.0006/keyword), Add keywords button (dialog: textarea one-per-line, device select, uses project location/language with per-batch override).
- MetricCards: tracked keywords, avg position, top-10 count, movement (net Δ7d).
- DataTable: keyword, device Badge, position (— when unranked), Δ1d / Δ7d / Δ30d (coloured, down-is-good for position), best position, ranking URL (path, full on title), 30-day inline sparkline (add a tiny `Sparkline` to components/charts/ if none exists — no axes, single series, ~120×28), remove action; multi-select remove; CSV of loaded rows.
- Movers panel: top 5 gainers + top 5 losers over 7d.
- States: skeletons; "no keywords yet" empty state pointing at Add keywords; note that new keywords show data after the first check completes (usually minutes).

## Retrofit

Keyword tables in Keyword Research + (later) Gap Analysis gain a "Track" row action → dialog picking a project (ProjectPicker) → POST tracked keywords. Implement in this phase's UI agent for Keyword Research's tables only; Gap comes with Phase 2's own retrofit list.

## Split

Worker agent first (projects routes, jobs infra, serp task wrappers, tracked-keyword routes + snapshot writer + live proof: track 3 keywords for brandpacks.com, run the real post→collect cycle against DataForSEO standard queue — this may take a few minutes of polling — and show snapshots written). Then one UI agent (Rank Tracking module + ProjectPicker + Sparkline + the Track retrofit).
