# OpenRefs architecture

One Cloudflare Worker runs everything: a Hono JSON API under `/api/v1` plus the React SPA served as static assets. Storage is D1 (SQLite via Drizzle), KV (DataForSEO response cache), and R2 (bulky blobs: raw audit data, exports). Background work uses cron triggers sweeping a D1 `jobs` table. Deliberately **no Queues and no Durable Objects** so self-hosting works on the free Workers plan.

## Locked decisions (2026-08-29)

- License **AGPL-3.0**. Hosted-only features (Stripe billing) behind config flags, off by default for self-host.
- **Per-workspace caching** — cached DataForSEO responses are keyed per workspace and never shared across tenants.
- Auth: **email + password only** (PBKDF2-SHA256, 100k iterations — the Cloudflare Workers runtime cap, which local dev does not enforce; WebCrypto). Cookie sessions, httpOnly + secure. Google OAuth exists only as the Search Console data connection (Phase 5), not for login.
- Default markets UK + US (`location_code` 2826 / 2840 — verify codes against the API), all DataForSEO locations selectable per query.
- Build order: see `docs/PLAN.md`.

## Stack

| Layer | Choice |
|---|---|
| Worker | Hono, TypeScript strict, zod validation |
| DB | D1 + Drizzle ORM (`drizzle-kit` migrations in `migrations/`) |
| Cache | Workers KV, keys `ws:<workspaceId>:dfs:<endpoint-hash>` (Search Console adds `…:gsc-token:<projectId>`, `…:gsc-broken:<projectId>` and `…:gsc:<projectId>:<propertyHash>:<dimensions>:<from>:<to>`, all under the same workspace prefix so one sweep clears them) |
| Blobs | R2, keys `ws:<workspaceId>/...` |
| Frontend | React + Vite (`@cloudflare/vite-plugin`), Tailwind v4, react-router, TanStack Query + Table, Recharts |
| Tests | vitest |
| CI | GitHub Actions: check, test, build |

## Directory layout

```
src/
  worker/          Hono app: index.ts, routes/ (one file per module), middleware/, cron.ts
  worker/dataforseo/  client.ts (auth+cache+meter), endpoint wrappers per API family
  db/              schema.ts (+ per-domain schema files), index.ts
  app/             React SPA: routes/, components/, styles/theme.css, lib/
  shared/          types + zod schemas shared worker<->app
migrations/        generated SQL
docs/              this file, PLAN.md, feature specs
```

## Data model (core; refine as needed, keep FKs + cascades)

- `users` (id, email unique, password_hash, created_at)
- `sessions` (id, user_id FK, expires_at)
- `workspaces` (id, name, dfs_login_enc, dfs_password_enc, spend_cap_usd, settings_json, created_at)
- `workspace_members` (workspace_id, user_id, role: owner|admin|member)
- `invites` (id, workspace_id, email, token_hash, role, expires_at)
- `api_keys` (id, workspace_id, name, key_hash, created_at, last_used_at)
- `projects` (id, workspace_id, domain, name, location_code, language_code, settings_json)
- `collections` (id, workspace_id, name) / `collection_keywords` (collection_id, keyword, volume_snapshot, added_at)
- `tracked_keywords` (id, project_id, keyword, location_code, language_code, device)
- `rank_snapshots` (tracked_keyword_id, date, position, url, serp_features_json)
- `audits` (id, project_id, dfs_task_id, status, summary_json, created_at) — raw pages to R2
- `api_usage` (id, workspace_id, endpoint, cost_usd, cached 0|1, created_at)
- `jobs` (id, type, payload_json, run_at, status: pending|running|done|failed, attempts, last_error)
- `gsc_connections` (project_id, refresh_token_enc, property, connected_by)
- `ai_prompts` (id, project_id, prompt, engines_json) / `ai_snapshots` (prompt_id, date, engine, mentioned 0|1, citations_json)

**Deletion cascade:** deleting a workspace removes every D1 row above (FK cascade), all KV keys under `ws:<id>:`, all R2 objects under `ws:<id>/`, revokes Google tokens, deletes the Stripe customer (hosted). Account (user) deletion removes the user and any workspaces where they are the sole owner.

## DataForSEO integration

- Base `https://api.dataforseo.com/v3/`, HTTP Basic auth (login:password). Sandbox base `https://sandbox.dataforseo.com/v3/` returns free dummy data — used in tests/CI via `DFS_BASE_URL` override.
- Credentials resolve per workspace (decrypted from D1); dev fallback from env (`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` in `.dev.vars`).
- Workspace credentials encrypted AES-256-GCM with `APP_MASTER_KEY` (WebCrypto), stored as `iv:ciphertext` base64.
- Every response includes `cost` — the client records it to `api_usage` (cached hits recorded with cost 0, cached=1), checks the workspace spend cap before spending, and exposes `GET /api/v1/usage` + a balance passthrough (`appendix/user_data`).
- Cache TTLs (KV `expirationTtl`): search volume & keyword ideas 30d; related/suggestions 14d; Labs SERPs, ranked keywords, domain overviews, backlink summaries 7d; historical/timeseries endpoints 30d; live SERP refreshes 24h; balance/user_data never cached. A `fresh: true` request param bypasses cache (still writes it).

## Design tokens — "Lush Forest"

Defined as CSS variables in `src/app/styles/theme.css`, consumed by Tailwind v4 `@theme`.

- `#2E6F40` primary (buttons, links, active nav, focus rings)
- `#68BA7F` primary-soft (hovers, secondary accents, chart series, success)
- `#CFFFDC` tint (subtle backgrounds, badges, highlighted rows)
- `#253D2C` ink (headings/body in light mode; base surface tone in dark mode)
- Neutrals: derive a gray ramp with a slight green cast; pure white surfaces in light mode, `#16211B`-range surfaces in dark mode. Both themes required (`.dark` class strategy), WCAG AA contrast for text.

## Product structure

Two modes: **ad-hoc research tools** (Keyword Research, Domain Overview, Backlinks, Gap Analysis, Content Discovery — query anything, no setup) and **Projects** (a site you own: Rank Tracking, Site Audit, Search Console, AI Visibility, named competitors). Left sidebar nav in that order, workspace switcher at top.

## Orchestrator contracts (added after scaffold review)

- **Crypto:** all hashing/encryption goes through `src/worker/lib/crypto.ts` (WebCrypto only, orchestrator-owned — do not add crypto code elsewhere). Password hashes: `pbkdf2$sha256$<iters>$<salt b64>$<hash b64>`. Encrypted secrets: `v1$<iv b64>$<ciphertext b64>` (supersedes the earlier `iv:ciphertext` note). Session / API-key / invite tokens: `randomToken()`, with only `sha256Hex(token)` ever stored.
- **Spend cap:** `workspaces.spend_cap_usd` — `0` blocks every paid call; `> 0` is a calendar-month (UTC) ceiling on summed `api_usage.cost_usd`. Cached reads are always allowed. Exceeded → HTTP 402, code `spend_cap_exceeded`.
- **Credential fallback:** workspace DataForSEO credentials come from D1 (encrypted). The `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` env fallback applies **only when `APP_ENV=development`** — hosted tenants must never spend on the operator's key.
- **Workspace scoping:** every workspace-scoped endpoint receives the workspace id explicitly (path param or `?workspace=`) and must verify the caller's membership against `workspace_members`. Never infer "the user's first workspace".

## Trademark rules

See CLAUDE.md "Hard rules" — banned Ahrefs/Moz/Google marks and our replacement vocabulary. README may describe OpenRefs as "an open-source alternative to tools like Ahrefs" (nominative use) but never uses their logos or screenshots.
