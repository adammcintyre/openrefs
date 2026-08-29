# Phase 7 spec — Content Discovery

Conventions from PHASE1 carry over. No new API family — this module COMPOSES existing wrappers (SERP live advanced, backlinks bulk_ranks, Labs) plus one or two new Labs/OnPage calls, into the "find low-competition topics with real traffic" workflow.

## Concept

Input a topic → we fetch its SERP (top 20) and, optionally, the SERPs of its top related keywords → deduplicate the ranking pages → enrich each page/domain with authority and traffic estimates → filterable table that surfaces **pages winning traffic without much authority** (the content opportunities).

## Worker

- `GET /api/v1/content/discover?workspace&topic&location&language&expand=0|5|10&fresh` — orchestrates:
  1. SERP for the topic (existing wrapper, ttl live).
  2. When `expand` > 0: top-N keyword ideas for the topic (existing wrapper) → their SERPs too (N more calls — the cost hint must reflect 1 + N SERP calls; verify per-SERP price).
  3. Dedupe pages across SERPs; for each unique page record which keywords it ranked for + best position.
  4. Enrich in bulk: Domain Scores via existing `backlinks/bulk_ranks` (≤100 targets — both domains AND exact page URLs if the endpoint supports URL targets per its docs; otherwise domain-level only, stated in the response); page/domain traffic estimates via Labs **bulk_traffic_estimation** (new wrapper — doc-verify; ttl short).
  5. Response: rows {page URL, domain, domainScore, pageScore?, estTraffic, keywords: [{keyword, position, volume}], totalVolume} + ResultMeta with the summed cost.
- Server-side filters as query params: maxDomainScore, minTraffic, include/exclude text on URL; sort by estTraffic|domainScore|totalVolume. Row cap ~200 per response; offset paging over the deduped set (computed once per query signature and cached — the composed result itself goes in KV, ws-scoped, ttl "live", so paging/filtering repeat calls are free).
- **Lazy word count**: `POST /api/v1/content/wordcount {workspace, urls: string[] ≤ 10}` via OnPage `content_parsing/live` (doc-verify; per-URL cost — encode the real price into the response so the UI hints truthfully). ttl long. Absent/failed pages → null.
- Types in src/shared/content.ts. Guards as usual; MOUNT_PROBES + 401 list extended.

## UI — Content Discovery (`/app/content-discovery`)

Search (topic + market + an Expansion select: "Just this topic" / "+5 related" / "+10 related", each with its ≈cost) →
- Summary strip: pages found, median Domain Score, total est. traffic represented, cost chip.
- The table: page (title if the SERP had one, URL path), domain, Domain Score (band-coloured), est. traffic, ranking keywords count (expandable row or popover listing keyword/position/volume), total volume touched, word count column (em dash + a "Count words (≈$x per 10)" bulk action for selected rows).
- Filter row: max Domain Score (THE knob — default empty, placeholder "e.g. 30"), min est. traffic, include/exclude URL text; a one-click preset chip **"Low-competition winners"** = maxDomainScore 30 + minTraffic 500, described honestly as a starting point.
- Row actions: open page (safe-scheme external link), View SERP (SerpPanel for its best keyword), copy URL. CSV of loaded rows.
- States: skeletons, empty ("no pages matched — loosen the Domain Score cap?"), no_credentials CTA, spend-cap notice, both themes.

## Also in this phase (backlog pull-through)

- Gap pages view: a "Pages" sub-tab on Gap Analysis using the existing `/api/v1/gap/pages` (columns: page, per-domain keyword counts/traffic per the shared type).
- Gap empty-state "Try Untapped" one-click switch.
- Collections: migration adding nullable locationCode/languageCode to collection_keywords (default the add-time market), enabling a View SERP action in collection detail.

## Split

Worker agent first (discover orchestration + bulk_traffic_estimation + wordcount + collections migration; live proof on topic "photo booth template" UK with expand=5, real costs). Then one UI agent (Content Discovery module + the two Gap retrofits + collection SERP action).
