# OpenRefs build plan

Each phase ships behind a review: spec → implementation (parallel agents on disjoint modules) → orchestrator code review → build/tests green → deploy to openrefs.adamm.io → Adam signs off.

## Phase 0 — Foundation (current)

- [x] Repo scaffold: single package, Worker (Hono) + SPA (Vite/React/Tailwind v4) via `@cloudflare/vite-plugin`, wrangler.jsonc with D1/KV/R2/assets/cron bindings, strict TS, vitest, CI workflow, AGPL LICENSE, README
- [x] Drizzle schema + initial migration (core tables per ARCHITECTURE.md), local migrations working
- [x] Auth + workspaces: register/login/logout (PBKDF2 + cookie sessions), workspace CRUD, members + roles, invites (link-based; email delivery lands later via SendGrid), API keys, full deletion cascade
- [x] DataForSEO client: basic-auth fetch wrapper, per-workspace credential store (AES-GCM), KV cache with TTL table, cost metering + spend caps, `/api/v1/usage`, balance endpoint, sandbox mode for tests
- [x] App shell + design system: Lush Forest theme (light/dark), sidebar nav (all modules listed, unbuilt ones disabled), auth pages, workspace settings pages, reusable DataTable/MetricCard/chart wrappers/empty states
- [x] Deploy pipeline: setup script creating real D1/KV/R2, first deploy to openrefs.adamm.io (live 2026-08-29)

## Phase 1 — Keyword Research + Domain Overview

**Status: shipped 2026-08-29 (v0.1.0).**

Keyword search (volume, history, difficulty, intent, CPC), ideas/related/suggestions tables, keyword → SERP view ("who ranks", cached with live refresh), collections + CSV export. Domain Overview: traffic estimate, Domain Score, top organic keywords, top pages, competitors, country split, paid search, history charts.

## Phase 2 — Backlinks + Gap Analysis

**Status: shipped 2026-08-29 (v0.2.0).**

Backlink profile (summary, referring domains, anchors, new/lost, history chart, Domain/Page Score). Gap Analysis: keywords competitors rank for that you don't (domain intersection), multi-competitor, filters (volume/difficulty/position), export; page-level gap.

## Phase 3 — Rank Tracking

**Status: shipped 2026-08-29 (v0.3.0).**

Cron + jobs infra hardened; daily SERP checks (standard queue) for tracked keywords per project (device + location), position history charts, best page, SERP features, movers report.

## Phase 4 — Site Audit

**Status: shipped 2026-08-29 (v0.4.0).**

OnPage API task lifecycle (post → poll via jobs → ingest), issue taxonomy mapped to: slow pages, CWV/Lighthouse, heavy CSS/HTML/JS, titles, meta descriptions, H1s, content, duplicates, indexability, social tags, localization, links, redirects, images, robots, sitemaps, structured data. Scores, per-issue drill-down, re-crawl compare.

## Phase 5 — Search Console

**Status: shipped 2026-08-29 (v0.6.0; Google OAuth client pending operator setup).**

Google OAuth (webmasters scope), property binding per project, opportunity reports: high-impression/low-CTR, positions 5–20 ("striking distance"), cannibalization, GSC-actual vs estimated overlay. Self-host: user supplies own OAuth client (guide).

## Phase 6 — AI Visibility

**Status: shipped 2026-08-29 (v0.6.0).**

DataForSEO AI Optimization API: prompt sets per project, scheduled runs across engines, mention/citation tracking, share-of-voice charts; AI Overview presence flags on tracked keywords.

## Phase 7 — Content Discovery

**Status: shipped 2026-08-31 (v0.7.0). All nine product modules live; 8a/8b public API + MCP also shipped.**

Topic search via SERPs enriched with traffic estimates, Domain Score, referring domains; filters (score/traffic/ref-domains; optional deep word-count scan); "low competition, real traffic" preset views.

## Phase 8 — Hosted polish

**Status: 8a/8b (API+MCP), 8c (email+reset), 8e (docs) shipped 2026-08-31 (v0.8.0). 8d (Stripe) awaits operator keys + pricing sign-off.**

Stripe ($10/m per workspace, unlimited members) behind config flag, SendGrid email (invites/resets), public API docs (OpenAPI) + MCP server endpoint for agents, self-host guide + Deploy-to-Cloudflare button, Google OAuth verification, marketing landing page, rotate all dev credentials.

## Phase 9 — Research workflow

**Status: shipped 2026-08-31 (v0.9.0).** First feedback round from real use
(spec: docs/specs/PHASE9.md): Suggestions-first keyword tabs with Ideas
demoted and lazy; per-workspace search history for Keyword Research, Domain
Overview and Gap Analysis (reopen = $0 from cache, Refresh = deliberate
spend, `fetchedAt` honesty chip); in-page keyword drill-down tabs; backlinks
sort + spam score/type columns + Hide-likely-spam; live sidebar spend
widget; rank tracking overview chart from a free D1 rollup endpoint.
