# Phase 8 spec — Public API, MCP server, hosted polish

Conventions carry over. This phase turns the existing API into a public product surface, adds the hosted-only business layer behind flags, and finishes the self-host story. Split into independent work packages; each ships separately.

## 8a — Public API docs

- Hand-maintained OpenAPI 3.1 document (`src/worker/openapi.ts` exporting the object; served at `GET /api/v1/openapi.json`, no auth) covering every stable `/api/v1` endpoint: auth model (session cookie OR `Authorization: Bearer orf_...` workspace API key), the error envelope, the `?workspace=` scoping rule, and per-endpoint params/response types matching `src/shared/*` exactly. A drift test imports the route registry and fails if a mounted module has no documented paths.
- `/developers` SPA page (public): how to mint an API key (Settings → API Keys), auth examples (curl), the spend/metering model, links to openapi.json. Self-contained; no external doc renderers.

## 8b — MCP server (agents are first-class users)

- `POST /mcp` implementing **stateless Streamable HTTP MCP** (JSON-RPC per request; no sessions, no SSE, and explicitly NO Durable Objects — hand-roll the protocol frames rather than adopting an SDK that requires DO; doc-verify the current MCP spec revision). Auth: the same `orf_` API key as the REST API (Bearer header); every tool call runs under that workspace with `member` role semantics and normal metering/spend caps.
- Tools (thin adapters over existing route logic — factor shared handlers if needed rather than duplicating): `keyword_overview`, `keyword_ideas`, `keyword_serp`, `domain_overview`, `domain_keywords`, `backlinks_summary`, `gap_keywords`, `list_collections`, `add_keywords_to_collection`, `list_projects`, `tracked_keywords`. Each declares a JSON Schema, returns compact JSON text content, and surfaces our error codes cleanly (spend_cap_exceeded etc. as tool errors, not protocol errors).
- Document on `/developers` with a copy-paste client config example.

## 8c — Email (SendGrid) + password reset

- `EMAIL_PROVIDER` config: `console` (default; logs, self-host-friendly) or `sendgrid` (`SENDGRID_API_KEY` secret + `EMAIL_FROM` var). One `src/worker/lib/email.ts` seam.
- Invites: when email is configured, sending an invite also emails the link (copy-link stays).
- Password reset: `password_resets` table via migration (token_hash, user_id, expires 1h, used_at); `POST /auth/forgot` (always 202, no enumeration, rate-limited per email AND per IP — pull the per-IP limiter from BACKLOG into `lib/rate-limit.ts` here), `POST /auth/reset {token, password}`; `/reset/:token` SPA page; sessions invalidated on reset.

## 8d — Stripe (hosted flag only)

- `BILLING_ENABLED` var (default off — self-host never sees any of this) + `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` secrets. Migration: workspaces gain stripeCustomerId, subscriptionStatus, trialEndsAt.
- Model (defaults; Adam confirms before enabling): $10/month per workspace, unlimited members, 14-day trial from workspace creation; past trial without an active subscription, data-spending endpoints return 402 `subscription_required` (settings/auth/usage stay reachable); Stripe Checkout to subscribe, Billing Portal to manage, webhook updates status. Workspace deletion cancels the subscription and deletes the customer (fills the Phase-0 TODO in lib/deletion.ts).
- Settings → General gains a Billing card only when the flag is on.

## 8e — Self-host + launch polish

- `docs/SELF-HOSTING.md`: complete walkthrough (fork/clone → setup-cloudflare.sh → secrets → deploy → first workspace), the free-plan footprint, updating, backups (D1 export), and the config matrix (email/billing/GSC all optional).
- README: Deploy-to-Cloudflare button, self-host section links, feature status refresh, screenshots (from production, our own).
- Pre-public-launch checklist (docs/LAUNCH.md): rotate the DataForSEO password; rotate APP_MASTER_KEY strategy documented (re-encrypt or ask users to re-enter); confirm CI green + delete smoke.yml + delete the actions-probe repo; flip repo public; tag v1.0.0; `/privacy` reviewed by Adam; Google OAuth verification submitted.

## Split

8a+8b one agent (API surface); 8c one agent; 8d one agent (behind flag, needs Stripe keys from Adam to E2E — build + unit-test regardless); 8e one agent (docs; screenshots via orchestrator). Orchestrator confirms the 8d business defaults with Adam before enabling billing in production.
