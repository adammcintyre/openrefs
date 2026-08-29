# Phase 2 spec — Backlinks + Gap Analysis

Read CLAUDE.md, docs/ARCHITECTURE.md, and docs/specs/PHASE1.md conventions first — workspace scoping, guard pattern, cost UX, wrapper discipline and doc-verification all carry over unchanged. New API family: **Backlinks API** (`backlinks/*`), plus two Labs endpoints.

## Domain Score (the metric)

DataForSEO's backlinks `rank` is 0–1000. We surface **Domain Score** and **Page Score**, both 0–100: `score = round(rank / 10)`. One normalization function in `src/worker/dataforseo/scores.ts`, unit-tested, used everywhere — never expose the raw 0–1000 number in API responses, and never use the banned trademark metric names (CLAUDE.md rule 2).

## Worker endpoints (all workspace-scoped, `member` role)

| Route | Source | TTL |
|---|---|---|
| `/api/v1/backlinks/summary?workspace&target` | backlinks summary (+ rank → Domain Score, referring domains, dofollow split, broken) | short |
| `/api/v1/backlinks/list?…&limit&offset&mode` | backlinks backlinks (mode one_per_domain \| as_is; filters: dofollow, anchor contains, min Domain Score) | short |
| `/api/v1/backlinks/referring-domains?…` | backlinks referring_domains | short |
| `/api/v1/backlinks/anchors?…` | backlinks anchors | short |
| `/api/v1/backlinks/history?…&from&to` | backlinks history/timeseries (monthly backlinks + referring domains) | long |
| `/api/v1/backlinks/scores` (POST, `{targets: string[]}` ≤ 100) | backlinks bulk_ranks → `{target, domainScore}[]` | short |
| `/api/v1/gap/keywords?workspace&target&competitors&…` | labs domain_intersection — verify max competitor count in docs; support ≥ 4. Modes: `missing` (competitors rank, you don't), `weak` (you rank worse than all), `untapped` (any competitor ranks, you absent), `all`. Server-side labs filters; volume/difficulty/position filters; offset paging | short |
| `/api/v1/gap/pages?…` | labs page_intersection | short |
| `/api/v1/gap/keywords/export.csv?…` | same query → CSV attachment (reuse Phase 1 CSV helpers) | — |

## UI — Backlinks (`/app/backlinks`)

Target search (domain or exact URL, location-independent) →
- MetricCards: Domain Score (prominent, 0–100 with colour band), backlinks total, referring domains, dofollow %.
- History TrendLineChart: backlinks + referring domains series with range picker (6m / 1y / all).
- Tabs **Backlinks** (source URL/domain, target page, anchor, Page Score of source, dofollow badge, first seen) | **Referring domains** (domain, Domain Score, backlink count, dofollow %) | **Anchors** (anchor text, backlinks, referring domains) — DataTables with sort/filter/Load-more, CSV of loaded rows.

## UI — Gap Analysis (`/app/gap-analysis`)

"You" input + up to 4 competitor chips (add/remove; prefill competitors from Domain Overview's competitor list when navigated from there) + location/language →
- Mode tabs Missing | Weak | Untapped | All, each explained in one quiet sentence.
- DataTable: keyword, volume, difficulty, your position, one position column per competitor (dash when absent), est. traffic for best competitor; filters (volume/difficulty/include-exclude); row actions View SERP (reuse Phase 1 panel) + Add to collection; bulk add; server CSV export.

## Retrofits in this phase

1. **SERP panel Domain Score column** — the Phase 1 SERP panel gains a Domain Score per result via one `POST /backlinks/scores` call (batched, cached); remove the "arrives with the Backlinks module" note.
2. **Settings harmonization** — rebuild the Phase 0 settings screens (`src/app/routes/settings/*`, currently on throwaway helpers in `settings/ui.tsx`) onto `components/ui/` primitives; delete `settings/ui.tsx`; while there, verify header controls (switcher chip, theme toggle, sign-out) render correctly in light mode and fix if not.
3. Landing page + README feature copy: Backlinks and Gap Analysis move from "arrives in Phase N" to live.

## Split

Worker agent first (endpoints + wrappers + scores + gap logic + live transcript vs real domains: brandpacks.com vs templatesbooth.com competitors hikelist.com), then two UI agents in parallel (Backlinks UI; Gap Analysis UI + the two retrofits).
