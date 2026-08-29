# Phase 6 spec — AI Visibility

Conventions from PHASE1/PHASE3 carry over (guards, wrappers, doc-verification, cost UX, jobs machinery, ProjectPicker). New API family: **DataForSEO AI Optimization** (`ai_optimization/*`). This family is their newest — doc-verify EVERYTHING at https://docs.dataforseo.com/v3/, including which engines/models are offered and per-call pricing (LLM responses cost notably more than SERP lookups; encode real prices into the cost hints).

## Concept

A project defines **prompts** a buyer might ask an AI assistant ("best photo booth template sites", "where can I download PSD templates"). On a schedule (weekly) and on demand, each prompt runs against selected engines (the family's supported set — expect the likes of ChatGPT/Gemini/Perplexity; use exactly what the docs offer). Each run records whether the project's domain is **mentioned** in the answer text and/or **cited** as a source, plus every cited URL. Over time that yields mention-rate and citation-rate per engine.

## Worker

- Tables exist: `ai_prompts` (prompt, engines_json), `ai_snapshots` (promptId, date, engine, mentioned, citationsJson). Add via migration only if genuinely missing something (e.g. a `responseExcerpt` text column on snapshots — keep excerpts ≤ 2000 chars; full responses go to R2 `ws:<id>/ai/<snapshotId>.json` only if trivially cheap to add).
- Wrappers `dataforseo/ai.ts` for the LLM-responses endpoint(s) (live or task-based per the docs; ttl "none" — results persist to D1/R2, and repeat runs are the product, not cache misses).
- Detection: `mentioned` = project domain appears in the answer text (host-insensitive; also match the project name when it's clearly derivable from the domain — document the rule); `cited` = domain appears in the response's source/citation URLs. Store all citation URLs. Unit-test the matcher hard (subdomains, www, paths, near-miss domains must NOT match).
- Routes: `/projects/:id/ai/prompts` CRUD (admin mutates; suggest starter prompts endpoint optional); `/projects/:id/ai/results?from&to` (per prompt × engine timeline + latest run detail); `POST /projects/:id/ai/run` (admin, cost hint = prompts × engines × per-call price, rate-limited 1/hour/project); weekly scheduled runs via a `seed_ai_weekly` job following Phase 3's seed_daily pattern.
- Retrofit (cheap, from stored data): rank-tracking snapshots already store `serp_features_json` — expose an `aiOverview: boolean` per tracked keyword in the Phase 3 keywords response, true when the latest snapshot's features include Google's AI Overview element type.

## UI — AI Visibility (`/app/ai-visibility`)

ProjectPicker → two areas:
- **Prompts manager**: list (prompt, engines badges, last run, latest mention/cite per engine as ✓/—), add dialog (prompt textarea + engine checkboxes), edit/remove, "Run now" with the real cost hint, note that scheduled runs happen weekly.
- **Results**: date-range picker; per-engine mention-rate TrendLineChart (per cent of prompts mentioning you); table of latest runs (prompt, engine, mentioned Badge, cited Badge, citation count) → drill-down showing the response excerpt with the mention highlighted and the citation URL list (external links, safe-scheme checked like the SERP panel).
- Rank Tracking retrofit: an "AI Overview" Badge column in the tracked-keywords table (tooltip: "Google shows an AI Overview for this keyword").
- Empty states explain the concept in two sentences; no data until first run.

## Split

Worker agent first (wrappers, matcher, routes, jobs, live proof: 2 prompts × 1–2 engines for brandpacks.com run end to end, real costs reported). Then one UI agent.
