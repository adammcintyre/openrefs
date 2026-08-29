# Phase 5 spec — Search Console integration

Conventions from PHASE1/PHASE3 carry over. This phase talks to **Google's APIs directly** (plain fetch — no SDK), not DataForSEO. It is config-gated: with no Google client configured, the module renders setup guidance instead of erroring.

## Configuration

- `GOOGLE_CLIENT_ID` (wrangler var) + `GOOGLE_CLIENT_SECRET` (secret). Absent → `GET /api/v1/gsc/status` reports `configured: false` and the UI shows self-host instructions (create an OAuth client of type Web application, authorized redirect URI `https://<your-host>/api/v1/gsc/callback`, enable the Search Console API).
- Scope: `https://www.googleapis.com/auth/webmasters.readonly` only. Offline access (refresh token), `prompt=consent` to guarantee one.

## OAuth flow (worker)

- `GET /api/v1/gsc/connect?workspace&project` (admin role) → 302 to Google's auth URL. `state` = a short-lived signed token (HMAC via lib/crypto sha256 with APP_MASTER_KEY-derived key, or an encrypted blob) binding {userId, workspaceId, projectId, expiry ≤ 10 min} — verified on callback; never trust bare query params.
- `GET /api/v1/gsc/callback?code&state` → verify state, exchange code (token endpoint), **encrypt the refresh token with encryptSecret**, upsert `gsc_connections` (projectId PK, refreshTokenEnc, property initially "", connectedBy), then 302 to `/app/search-console?connected=1`.
- Access tokens: derived on demand from the refresh token (cache in KV `ws:<id>:gsc-token:<project>` with TTL ~50 min); a refresh failure with `invalid_grant` marks the connection broken → UI prompts reconnect.
- `GET /api/v1/gsc/sites?workspace&project` → Google sites.list, for the property picker. `PATCH /api/v1/gsc/connection?workspace&project {property}` → store chosen property (must be one returned by sites.list). `DELETE /api/v1/gsc/connection?...` → call Google's revoke endpoint with the refresh token, then delete the row. **Also complete the Phase-0 TODO in lib/deletion.ts**: workspace deletion revokes every project's Google token before the D1 row cascades (best-effort: a failed revoke logs and continues).

## Data + reports (worker)

`POST` to `searchanalytics.query` for the connected property; cache responses in KV (ws-scoped, TTL 24h; GSC data lags ~2 days anyway). All endpoints workspace-scoped, member role, date range params `from`/`to` (default last 28 complete days), and every response notes the data-lag in a `freshTo` field:

- `GET /api/v1/gsc/overview` — clicks/impressions/ctr/position total + daily series (dimension: date).
- `GET /api/v1/gsc/queries` — top queries (clicks, impressions, ctr, position; limit/offset over the fetched set, rowLimit 5000).
- `GET /api/v1/gsc/pages` — same by page.
- `GET /api/v1/gsc/opportunities` — computed worker-side from one queries pull + one query+page pull:
  - `striking_distance`: position 5–20 AND impressions ≥ p50 of the set — nearly-there keywords.
  - `low_ctr`: position ≤ 10 AND ctr below half the expected-CTR curve for that position (hardcode a documented curve; cite it in a comment) — title/meta rewrite candidates.
  - `cannibalization`: queries where ≥ 2 pages each earn ≥ 20% of the query's clicks — consolidation candidates.
  Each list: query, page(s), clicks, impressions, ctr, position, and which rule fired.

Types in `src/shared/gsc.ts`. No DataForSEO spend anywhere in this phase; cost chips are replaced by a "data to <freshTo>" chip.

## UI — Search Console (`/app/search-console`)

ProjectPicker empty state → per connection state: not configured (self-host setup card) / not connected ("Connect Google Search Console" button → full-page redirect; on `?connected=1` show property picker from /gsc/sites) / connected (property Badge + disconnect in a menu):
- Date-range picker (28d / 3m / 6m / custom), persisted per project.
- Overview: four MetricCards (clicks, impressions, avg CTR, avg position — position uses down-is-good polarity) + daily TrendLineChart (clicks + impressions, dual series).
- Tabs Queries | Pages | **Opportunities** (the headline: three sub-sections with rule explanations, each a DataTable + CSV of loaded rows; row action "View SERP" where a query maps to a keyword — reuse SerpPanel with the project's market).
- Broken-connection state (invalid_grant) → reconnect CTA.

## Static privacy page (prerequisite for Google verification)

Add `/privacy` to the SPA (public, linked from the landing footer): a plain, honest privacy policy — what we store (account email, encrypted API credentials, encrypted Google tokens, usage metering), that data lives in the operator's Cloudflare account, the full-deletion guarantee, no analytics/tracking beyond operational logs. Mark hosted-specific lines clearly so self-hosters can adapt.

## Operator prerequisites (Adam, before hosted launch of this module)

1. Google Cloud project → OAuth consent screen (External), app name OpenRefs, scope webmasters.readonly, privacy policy URL `https://openrefs.adamm.io/privacy`.
2. OAuth client (Web application) with redirect URI `https://openrefs.adamm.io/api/v1/gsc/callback` → set GOOGLE_CLIENT_ID var + GOOGLE_CLIENT_SECRET secret.
3. Submit for verification when moving past the 100-test-user cap (not needed for our own testing).

## Split

Worker agent first (OAuth flow + reports + revocation + privacy-page copy review; live verification limited to `status`/`connect` URL shape + state-token round-trip + mocked-token unit tests — full Google round-trip happens once credentials exist). Then one UI agent. If GOOGLE_CLIENT_ID is configured in .dev.vars by then, the worker agent runs the real flow end to end with the orchestrator's help; otherwise E2E waits for the operator step and the module ships behind its `configured: false` guard.
