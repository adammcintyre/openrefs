# Phase 4 spec — Site Audit

Conventions from PHASE1/PHASE3 carry over (scoping, guards, wrappers, doc-verification, cost UX, jobs machinery, ProjectPicker). New API family: **OnPage API** (`on_page/*`) — DataForSEO's crawler does the crawling; we orchestrate, ingest, and present.

## Flow

1. `POST /api/v1/projects/:id/audits` {maxCrawlPages: 25|100|250|500|1000, renderJs: boolean} (admin role) → on_page task_post (target from project domain; enable relevant checks; verify current parameters/pricing in docs — expect roughly fractions of a cent per page, JS rendering costlier) via the client (spend cap gates it; ttl "none"), insert `audits` row (status `pending`, dfs_task_id), enqueue `audit_poll` job.
2. `audit_poll` job: on_page summary for the task — while `crawl_progress` unfinished, re-enqueue with backoff (1–5 min); when finished, ingest:
   - summary rollup (pages crawled, checks totals, OnPage score) → `audits.summary_json`
   - paged pulls of `pages` (and `non_indexable`, `duplicate_tags`, `redirect_chains`, `links` where needed) → raw JSON to R2 under `ws:<workspaceId>/audits/<auditId>/<section>-<page>.json`
   - a computed **issues index** (see taxonomy) → also into summary_json (counts per issue), affected-page references into R2.
   - status → `done` (or `failed` with the upstream message).
3. Lighthouse/CWV: on_page lighthouse task for the homepage (and only the homepage in v1 — per-page Lighthouse is priced per run); store the scores + core-web-vitals metrics in summary_json.

## Issue taxonomy (maps DataForSEO page `checks` + sections to our categories)

Categories (fixed ids, shown in this order): `slow_pages`, `core_web_vitals`, `heavy_pages` (large HTML/CSS/JS, uncompressed/unminified), `titles`, `meta_descriptions`, `h1`, `content` (thin/low readability), `duplicates` (title/description/content), `indexability` (non-indexable, canonical issues, 4xx/5xx), `social_tags` (OG/twitter missing), `localization` (lang/hreflang), `links` (broken internal/external, orphans), `redirects` (chains/loops, meta refresh), `images` (broken, missing alt, oversized), `robots_sitemaps` (robots.txt issues, sitemap missing/invalid), `structured_data` (markup errors). Each category: severity (error|warning|notice), affected-page count, and which DataForSEO checks feed it (document the mapping in `src/worker/audit/taxonomy.ts` with a unit test pinning it). A check we don't map lands in a visible `other` bucket rather than disappearing.

## Endpoints

- `POST /projects/:id/audits` (above), `GET /projects/:id/audits` (history list: date, pages, score, status), `GET /audits/:auditId` (summary + categories + lighthouse), `GET /audits/:auditId/issues/:category?page=` (affected pages, hydrated from R2, paginated ~50), `DELETE /audits/:auditId` (admin; removes R2 prefix + row).
- Types in `src/shared/audits.ts`.

## UI — Site Audit (`/app/site-audit`)

ProjectPicker empty state → audit view:
- No audits yet: explainer card + "Run first audit" (pages select with cost hint, JS-rendering toggle "≈10× cost" (verified pricing)).
- Running: progress state (poll `GET /audits/:id` every ~10s client-side; show pages-crawled if the summary exposes it).
- Done: health score (big number 0–100 from OnPage score), CWV strip for the homepage (LCP/CLS/INP + Lighthouse perf score, colour-banded), issues DataTable (category, severity Badge, affected pages, one-line description) → category drill-down page listing affected URLs (path + the specific failing values where available: current title, its length, target of redirect, etc.) with CSV export.
- History: previous audits list; selecting one shows it; **compare chip** on the latest ("+3 / −7 vs previous") per category — computed from the two summary_json rollups, no extra fetches.
- Re-run button (cost hint), delete old audits (ConfirmDialog).

## Split

Worker agent first (wrappers, taxonomy, routes, jobs, live proof: run a real 25-page audit of brandpacks.com end to end — post, poll to completion, ingest, drill one category, delete a scratch audit; report cost). Then one UI agent. Also fold in from BACKLOG.md: dashboard MetricCards get real workspace data (tracked keywords count, average position, month spend, collections count) — worker adds a tiny `GET /api/v1/dashboard?workspace=` rollup; UI agent replaces the sample cards and removes the "Sample" badges.
