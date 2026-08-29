# Backlog — small deferred items

- **DataForSEO tarpits Cloudflare egress** (multiple episodes 2026-08-29, worsening through the day): for minutes at a time EVERY POST family (Labs, on_page task_post) from the Worker hangs past 80s/2 attempts, while identical calls answer in <1s from residential IPs; GETs (user_data) stay fast; windows clear on their own (one 1.36s success 6 min after an 80s double-timeout). Leading theory: **DFS rate-limits per source IP and Workers egress IPs are shared across many Cloudflare tenants** — other tenants' load poisons the shared IP. Support-ticket text for Adam: "Our app calls your live API from Cloudflare Workers. Requests from Workers egress IPs intermittently hang for minutes (all POST endpoints; GETs unaffected) while the same authenticated calls are instant from other networks — consistent with per-IP throttling on shared cloud egress. Can our account (team@brandpacks.com) be rate-limited by auth rather than source IP, or the Workers ranges allowlisted?" Product mitigation worth building (Phase 7 wave): **stale-if-error caching** — store cache entries without KV expirationTtl, carry a soft TTL in the payload, serve expired-but-present data with a "stale" flag when the upstream times out.

Owned by the orchestrator; phase agents pick these up when a spec says so. Add here rather than losing things in reports.

- **Collections: record market per keyword** — `collection_keywords` has no location/language, so the collection detail view can't offer "View SERP". Needs a small migration (nullable columns, default the workspace's last-used market on add) + UI action. Target: Phase 7 polish.
- **Related-keywords depth expansion** — the Labs endpoint returns a keyword graph (depth 1–4); v1 shows depth 1 flat. An "expand" affordance is a nice later win. Target: Phase 7.
- **Login rate limiting is per-email only** — add a per-IP dimension (CF-Connecting-IP) to `lib/rate-limit.ts`. Target: Phase 8 hardening.
- **Dashboard still shows sample data** — replace MetricCards/chart with real workspace numbers (tracked keywords, avg position, spend, collections) once Rank Tracking exists. Target: Phase 4 wave or later.
- **OG image is SVG-only** — X/Facebook need a 1200×630 PNG. Target: Phase 8 marketing polish.
- **GitHub Actions** — account billing lock (user-side). When cleared: confirm CI green, delete `.github/workflows/smoke.yml`, delete throwaway repo `adammcintyre/actions-probe`.
- **`no_credentials` / `spend_cap_exceeded` UI states never exercised live** — dev always has the fallback key. Verify both renders once against production (a workspace with no credentials sees the CTA). Target: Phase 2 visual pass.
- **`@cloudflare/vitest-plugin`** — adopt when a test genuinely needs real D1/KV bindings.
- **Version bump discipline** — `src/shared/version.ts` is a literal; bump at each phase deploy.
- **Gap pages view** — `/api/v1/gap/pages` (page_intersection) is live and typed but has no UI; add as a sub-view of Gap Analysis. Target: Phase 7 polish.
- **Gap "try Untapped" affordance** — when `missing` is empty, offer a one-click switch to Untapped rather than only explanatory copy. Target: Phase 7 polish.
- **Re-home `components/gap/domain-scores.ts` + `score-cell.tsx`** under `components/backlinks/` (they're generic Backlinks bindings; landed under gap/ only for wave file-ownership reasons). Cosmetic.
- **structured_data drill-down is an 18-column table** — worker could mark primary detail keys per category so the UI leads with the failing value. Target: Phase 7 polish.
- **Queue-back the audit task_post** — POST /audits currently calls DataForSEO inline, so a tarpit window fails the user's click; instead insert the audit row as pending and let a job post the crawl with the queue's own retry/backoff. Same pattern wherever a user click triggers a task_post. Target: Phase 7 worker wave.
