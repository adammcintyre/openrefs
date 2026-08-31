# Phase 9 — Research workflow (v0.9.0)

First round of post-launch feedback from real use (Adam, 2026-08-31). Eight
items, three build packages. Shared contracts land first on main
(`src/shared/history.ts`, `ResultMeta.fetchedAt`, `RankSummary*`,
`BACKLINK_SORTS`, `src/app/components/history/queries.ts`) so the packages can
build in parallel.

## The feedback, verbatim intent

1. Keyword "Ideas" results are loosely related category terms; "Suggestions"
   is far better. → Suggestions becomes the first and default tab, Ideas moves
   last (tabs already fetch lazily, so Ideas now costs nothing until opened).
2. Keyword Research: a history of past searches; clicking one shows the cached
   result ($0) with a Refresh button that re-bills deliberately.
3. Keyword Research: clicking a keyword in results opens a new **in-page**
   research tab, so drill-downs never lose the trail.
4. Domain Overview: same history, with key metrics shown in the list.
5. Backlinks: spam first, authority missing → expose sort + spam controls,
   show spam score / link type. (Iframe links: not in the provider's index at
   all — item_type is only anchor/image/meta/canonical/alternate/redirect.)
6. Sidebar API-spend widget: replace the hardcoded sample with live usage.
7. Gap Analysis: same history treatment as 2.
8. Rank Tracking: a full-width overview chart at the top of the page.

## Cache semantics (the round's one real mechanism)

- `stale=true` on a research GET: serve the KV copy even past its soft TTL
  (within the 90-day hard cap), `stale: true`, $0, **no network**. New client
  option `allowStale`. History clicks use this.
- `fresh=true` (already existed for SERP): bypass the cache, bill, rewrite KV.
  Refresh buttons use this. `fresh` + `stale` together is a 422.
- `ResultMeta.fetchedAt` (ISO) now says when the payload was really fetched,
  so the UI can render "Updated N days ago" honestly.

## Packages

- **9a worker**: `search_history` table (migration 0005, workspace-cascade,
  upsert on canonical params, pruned to 100/module) + `/api/v1/history`
  list/delete/clear; recording hooks in keywords/domains/gap services;
  `allowStale` + `fetchedAt` in the DataForSEO client; `stale`/`fresh` params
  across keywords/domains/gap routes; backlinks `sort` + `maxSpamScore`
  params; `GET /projects/:id/rank/summary` (D1 rollup, free); OpenAPI kept in
  drift-test sync.
- **9b keyword UI**: tab reorder + single label source; in-page research tab
  strip (sessionStorage per workspace, cap 8, dedupe, close); clickable
  keyword cells; history panel; Updated-chip + Refresh with the billing
  invariants (open-from-history bills nothing; Refresh bills one pass).
- **9c modules UI**: Domain Overview + Gap history panels with the same
  refresh semantics; backlinks sort select, Hide-likely-spam toggle, spam
  score + link type columns; live usage widget (GET /usage + workspace cap);
  rank overview chart (bands top3/top10/top100 + average position, 30/90d)
  from the new summary endpoint.

## Invariants

- A history click or reopened research tab never bills; only an explicit
  search, Load more, or Refresh does.
- Recording history must never fail or slow a search response (waitUntil).
- New table rides the workspace deletion cascade; no new KV/R2 key families.
- Trademark vocabulary unchanged (Domain Score / Page Score, etc.).
