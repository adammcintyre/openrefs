# Phase 1 spec — Keyword Research + Domain Overview

Read CLAUDE.md and docs/ARCHITECTURE.md first; their hard rules apply to everything here. Every endpoint below is workspace-scoped: `?workspace=<id>`, guarded by `requireSession` + `requireWorkspaceRole(db, session, id, "member")` exactly like routes/usage.ts.

## Conventions

- Every DataForSEO call goes through the client via typed wrappers in `src/worker/dataforseo/` (one file per API family). Verify request/response shapes against https://docs.dataforseo.com/v3/ — never guess field names. Zod-parse the fields we consume; keep the raw item reachable.
- **Free-metadata cache exception:** DataForSEO's locations/languages lists cost $0 and are not tenant data. The client gains an opt-in `cacheScope: "global"` (default remains `"workspace"`) that keys the cache as `meta:dfs:<endpoint-hash>` — allowed ONLY for an allowlist of zero-cost appendix/list endpoints, asserted in the client. This is the sole exception to per-workspace cache keys.
- Cost UX: cheap lookups (fractions of a cent) need no ceremony; explicitly-expensive actions (country breakdown ≈ 10 calls, SERP refresh) get a small "≈ $x.xx" hint in the UI.
- Error surfaces: `no_credentials` (409) → inline CTA to Settings → Data Provider; `spend_cap_exceeded` (402) → inline notice linking Settings → General; others → toast + retry affordance.

## Worker endpoints

| Route (GET unless noted) | Source (family/endpoint) | TTL |
|---|---|---|
| `/api/v1/keywords/overview?workspace&keyword&location&language` | keywords_data google_ads search_volume live (volume + monthly history) + labs bulk_keyword_difficulty + labs search_intent | long |
| `/api/v1/keywords/ideas?…&limit&offset` | labs keyword_ideas (exists) | long |
| `/api/v1/keywords/suggestions?…` | labs keyword_suggestions | medium |
| `/api/v1/keywords/related?…` | labs related_keywords | medium |
| `/api/v1/keywords/serp?…&fresh` | serp google organic live advanced — top 20 organic + SERP feature list | live |
| `/api/v1/domains/overview?workspace&domain&location&language` | labs domain_rank_overview (organic + paid metrics) | short |
| `/api/v1/domains/history?…` | labs historical_rank_overview | long |
| `/api/v1/domains/keywords?…&paid&offset` (+filters/sort) | labs ranked_keywords (exists) | short |
| `/api/v1/domains/pages?…` | labs relevant_pages | short |
| `/api/v1/domains/competitors?…` | labs competitors_domain | short |
| `/api/v1/domains/countries?…` | domain_rank_overview across ~10 major markets (US, UK, DE, FR, ES, IT, AU, CA, NL, IN — resolve exact location codes from the locations list at build time, don't hardcode blindly) | short |
| `/api/v1/meta/locations?engine=google`, `/api/v1/meta/languages` | appendix locations/languages lists ($0) | global, 30d |

Collections (JSON CRUD, `member` role): `GET/POST /api/v1/collections`, `PATCH/DELETE /:id`, `GET /:id` (with keywords), `POST /:id/keywords` `{keywords:[{keyword, volumeSnapshot?}]}` (bulk, idempotent), `DELETE /:id/keywords` (bulk), `GET /:id/export.csv` (text/csv attachment, proper escaping). Existing `collections`/`collection_keywords` tables suffice — no schema change without a migration and a strong reason.

Shared response types live in `src/shared/` (keywords.ts, domains.ts, collections.ts) — the UI agents build against them.

## UI — Keyword Research (`/app/keyword-research`)

Search bar: keyword + location/language selects (options from `/meta/*`, last-used persisted in localStorage per workspace). Results:
- Overview strip: MetricCards for volume, difficulty (0–100, badge-coloured), CPC, intent; 12-month volume TrendLineChart.
- Tabs **Ideas | Suggestions | Related**: DataTable (keyword, volume, difficulty, CPC, intent), sortable, filter row (min/max volume + difficulty, include/exclude text), row actions "View SERP" and "Add to collection" (dialog with inline create-new), multi-select bulk add, "Load more" offset paging.
- **SERP panel** (drawer) for any keyword: position, title, URL, domain, SERP-feature chips; Refresh button (`fresh=true`) with cost hint; a quiet note that the Domain Score column arrives with the Backlinks module.
- **Collections** at `/app/keyword-research/collections` (+ `/:id`): list/create/rename/delete (ConfirmDialog), keyword table (volume snapshot, added date), remove, CSV export button.

## UI — Domain Overview (`/app/domain-overview`)

Search (domain + location/language) → dashboard:
- MetricCards: organic traffic estimate, organic keywords, paid traffic, paid keywords; traffic-history TrendLineChart (organic/paid series).
- Tabs **Top keywords** (position, volume, est. traffic, URL; organic/paid toggle; reuses the SERP panel) | **Top pages** (URL, est. traffic, keyword count) | **Competitors** (domain, common keywords, est. traffic; "Analyze" swaps the target) | **Countries** (lazy-loaded behind a button with the ≈cost hint; bar chart + table).
- Tables export loaded rows as CSV client-side.

Both pages: skeletons, empty states, no-credentials CTA, spend-cap notice, both themes, keyboard/AA per the design system.

## Phase 1 leftovers folded in

- Dev-only spend-cap proof: a `/api/v1/dev/` check that sets a scratch workspace's cap to 0 and asserts a wrapper call returns 402 without spending (closes the untested 402 path from Phase 0).
- Settings screens still use throwaway helpers (`routes/settings/ui.tsx`) — harmonizing them onto `components/ui/` primitives is queued for the Phase 2 UI wave, not this one.
