# Self-hosting OpenRefs

OpenRefs is one Cloudflare Worker (API + static SPA) backed by D1, KV and R2.
Deliberately no Queues and no Durable Objects, so a self-hosted instance runs
entirely on Cloudflare's free Workers plan — check
[Cloudflare's current pricing](https://www.cloudflare.com/plans/developer-platform/)
for the exact limits, but nothing in this codebase requires a paid tier.

The only recurring cost is your own DataForSEO usage, billed to your own
DataForSEO account. OpenRefs never sees or touches that money — see
[Costs](#costs) below for what things actually cost.

## Prerequisites

- **A Cloudflare account.** Free plan is sufficient — see above.
- **A DataForSEO account.** Sign up at [dataforseo.com](https://dataforseo.com)
  and top up a balance. There's no OpenRefs-specific minimum; a starting
  top-up of around $50 comfortably covers exploratory use while you get a feel
  for what your own usage costs (see [Costs](#costs)) — DataForSEO's own site
  has their current minimums and top-up options.
- **Node.js 22 or later** (`package.json` pins `"engines": { "node": ">=22" }`).
- **git**, and a clone of this repository.

## Local development

```bash
git clone https://github.com/adammcintyre/openrefs.git
cd openrefs
npm install

cp .dev.vars.example .dev.vars   # git-ignored — fill in real values
npm run db:migrate:local         # creates the local D1 schema
npm run dev                      # http://localhost:5173
```

`.dev.vars` is read by both `wrangler` and the Vite dev server and must never
be committed (it's already in `.gitignore`). At minimum, set:

- **`APP_MASTER_KEY`** — the AES-256-GCM key that encrypts DataForSEO
  credentials at rest. It must be **exactly 32 bytes as hex (64 hex
  characters)**; `src/worker/lib/crypto.ts` rejects anything else. Generate
  one with:

  ```bash
  openssl rand -hex 32
  ```

- **`DATAFORSEO_LOGIN`** / **`DATAFORSEO_PASSWORD`** — a local-dev-only
  fallback. With `APP_ENV=development` (the default in `.dev.vars.example`),
  any workspace with no stored credentials of its own falls back to these two
  values, so you can click around locally without creating a workspace
  first. This fallback is read **only** when `APP_ENV=development`
  (`src/worker/dataforseo/credentials.ts`) — a deployed Worker always has
  `APP_ENV=production` from `wrangler.jsonc` and ignores both variables
  entirely, by design: a hosted tenant who never enters their own key must
  never spend on yours.

Everything else in `.dev.vars.example` (`GOOGLE_CLIENT_ID`/`SECRET`,
`DFS_PROXY_URL`/`TOKEN`) is optional — see the
[optional configuration](#optional-configuration) table below.

### Your first workspace

Registering an account (`/register`) creates your user **and** a first
workspace in the same step — there's no separate "create a workspace" wizard.
You land as that workspace's `owner`. A new workspace's DataForSEO spend cap
defaults to **$25/month** (`src/db/schema.ts`); raise, lower, or zero it in
Settings → General. A cap of `$0` blocks every paid call outright while still
allowing cached reads.

Add your DataForSEO login and password under Settings → DataForSEO
credentials (or rely on the dev fallback above while developing locally).
They're encrypted with `APP_MASTER_KEY` before they reach the database and
are never sent back to the browser once saved.

One thing worth knowing before you expose an instance beyond your own
machine: registration is open by default. `POST /api/v1/auth/register`
(`src/worker/routes/auth.ts`) has no invite-only gate and no allowlist —
anyone who can reach the URL can create an account. If you want to restrict
that, put your own access control (Cloudflare Access, a firewall rule, etc.)
in front of the deployment; OpenRefs doesn't ship one.

## Deploying to your own Cloudflare account

```bash
npx wrangler login
./scripts/setup-cloudflare.sh
```

`scripts/setup-cloudflare.sh` is idempotent — safe to re-run. It:

1. Creates the D1 database, KV namespace and R2 bucket if they don't already
   exist (`openrefs-db`, binding `CACHE`, `openrefs-blobs`).
2. Patches the real resource ids into `wrangler.jsonc`, preserving the
   surrounding comments.
3. Prints the `wrangler secret put` command(s) you need to run yourself — it
   deliberately never handles a secret's value itself.
4. Applies migrations to the new remote database
   (`wrangler d1 migrations apply openrefs-db --remote`).

Run the secret command it prints:

```bash
npx wrangler secret put APP_MASTER_KEY
```

That's the one secret a deploy requires — `wrangler secret put` prompts
interactively so the value never touches your shell history or a CI log. Use
the same hex format described above. Do **not** set `DATAFORSEO_LOGIN` /
`DATAFORSEO_PASSWORD` as secrets in production: every workspace brings its own
credentials through Settings, and production ignores the env fallback
entirely regardless of whether it's set.

Then:

```bash
npm run types    # regenerates worker-configuration.d.ts from wrangler.jsonc
npm run deploy    # npm run build && wrangler deploy
```

> The script's own closing summary says "set the three secrets above" —
> that's stale wording left over from an earlier version; the section right
> above it now lists only the one required secret. `GOOGLE_CLIENT_SECRET` and
> the `DFS_PROXY_*` secrets below are genuinely optional and the script
> doesn't ask for them.

### Custom domain vs. `workers.dev`

`wrangler.jsonc` ships with our own hosted route:

```jsonc
"routes": [{ "pattern": "openrefs.adamm.io", "custom_domain": true }],
```

Replace `"openrefs.adamm.io"` with your own domain (it must already be a
Cloudflare-managed zone on your account), or delete the `routes` block
entirely — without it, `wrangler deploy` still publishes the Worker to its
free `<name>.<your-subdomain>.workers.dev` address.

## Optional configuration

Everything below is genuinely optional. Leave it unset and the corresponding
feature reports itself unconfigured instead of erroring.

| Feature | Env vars | Where | Status if unset |
| --- | --- | --- | --- |
| Search Console | `GOOGLE_CLIENT_ID` (var), `GOOGLE_CLIENT_SECRET` (secret) | `wrangler.jsonc` vars / `wrangler secret put` | `GET /api/v1/gsc/status` reports `configured: false`; the Search Console module shows self-host setup instructions instead of a Connect button |
| DataForSEO egress relay | `DFS_PROXY_URL`, `DFS_PROXY_TOKEN` (both secrets) | `wrangler secret put` | Calls go straight to `api.dataforseo.com` (the default, and correct for local dev and most deployments) |

**Search Console.** In the Google Cloud console: create or pick a project,
enable the Search Console API, then configure an OAuth consent screen
(External) requesting only
`https://www.googleapis.com/auth/webmasters.readonly` — read-only, so
OpenRefs can never change anything in a connected property. Create an OAuth
client of type **Web application** with an authorized redirect URI matching
your deployment **byte for byte** (Google compares the string; a missing or
extra trailing slash is a `redirect_uri_mismatch`):

- Production: `https://<your-host>/api/v1/gsc/callback`
- Local dev: `http://localhost:5173/api/v1/gsc/callback`

Set the consent screen's privacy-policy URL to your deployment's `/privacy`
page. Put the client id in `wrangler.jsonc` under `vars.GOOGLE_CLIENT_ID` (it's
public by design — it appears in every auth URL your users are sent to) and
the client secret via `wrangler secret put GOOGLE_CLIENT_SECRET`. While your
OAuth consent screen is in "Testing" status, only up to 100 explicitly-added
test users can connect; past that you'd need to submit it for Google's
verification review (see `docs/specs/PHASE5.md`).

**DataForSEO egress relay.** Some deployments see DataForSEO calls hang for
minutes at a time from Cloudflare Workers' shared egress IPs, then answer
instantly from any other network — see
[Troubleshooting](#dataforseo-is-slow-or-hangs) below. `DFS_PROXY_URL` +
`DFS_PROXY_TOKEN` point the client (`src/worker/dataforseo/client.ts`) at a
small authenticated forwarder on infrastructure with a clean IP instead of
calling DataForSEO directly; it isn't part of this repository and OpenRefs
doesn't ship or run one for you — you'd need to host your own tiny
authenticated HTTPS forwarder in front of `api.dataforseo.com/v3` and point
these two variables at it. **Most self-hosters won't need this.** Leave both
unset and calls go straight to DataForSEO, which is the default and is
correct for local development.

**Not yet available for self-hosters (or anyone): transactional email and
billing.** `docs/PLAN.md` Phase 8 scopes an `EMAIL_PROVIDER` config (SendGrid
or console-log fallback) for invite emails and password-reset, and a
`BILLING_ENABLED` flag wrapping Stripe subscriptions. Neither has landed in
this codebase yet — there is no email-sending code path at all today, and no
Stripe integration. Concretely: invites are link-based only (copy the link
from Settings → Members and send it yourself), and there is currently no
self-service "forgot password" flow — if a user loses their password, nobody
can reset it for them through the product yet. Nothing to configure for
either; this section will grow once they ship.

## Updating

```bash
git pull
npm install                    # in case dependencies changed
npm run db:migrate:remote      # apply any new migrations to your D1 database
npm run deploy                 # npm run build && wrangler deploy
```

Check `migrations/` for anything new before you pull if you want to preview
schema changes — each is a plain, readable `.sql` file
(`drizzle-kit generate` output, applied with `wrangler d1 migrations apply`).

## Backups

The Worker holds no state outside D1, KV and R2:

- **D1** (`openrefs-db`) is everything relational — accounts, workspaces,
  encrypted credentials, projects, tracked keywords, rank history, audit
  summaries, usage metering, jobs. Export it with wrangler's own tool:

  ```bash
  npx wrangler d1 export openrefs-db --remote --output=backup.sql
  ```

  (`--local` exports your local dev database instead.) This is a plain SQL
  dump; restoring is importing it into a fresh D1 database the same way you'd
  restore any SQLite dump.
- **KV** (binding `CACHE`) holds only DataForSEO response cache and derived
  tokens, all disposable and rebuilt on demand — nothing here needs backing
  up.
- **R2** (`openrefs-blobs`) holds bulkier blobs behind Site Audit (raw crawl
  data) and exports. `wrangler d1 export` does not touch R2. There's no
  built-in export tool for it in this repo today; if your audit history
  matters to you, back up the bucket separately (e.g. `wrangler r2 object
  get` per key, or a sync tool of your choice against the R2 API).

## Costs

**Cloudflare:** designed to fit the free Workers plan — no Queues, no Durable
Objects (CLAUDE.md hard rule, enforced by review, not just convention).
Background work is a cron trigger every 5 minutes (`wrangler.jsonc`
`triggers.crons`) sweeping a `jobs` table in D1, not a paid queue product.

**DataForSEO:** metered, pay-as-you-go, billed straight to the account you
entered in Settings — OpenRefs marks nothing up and never sees the money.
Real per-call figures, straight from the code that computes them (all
verified against DataForSEO's pricing pages as of 2026-08-29; check those
pages for the current numbers before relying on them):

| Module | What it costs | Source |
| --- | --- | --- |
| Rank Tracking | Standard-queue Google Organic SERP: **$0.0006 per 10 results**, multiplied by depth. A tracked keyword is checked at depth 100, i.e. **$0.006/keyword/check** | `src/worker/dataforseo/serp.ts` (`SERP_TASK_PRICE_PER_10_RESULTS_USD`, `RANK_TASK_PRICE_USD`) |
| Domain Overview / Gap Analysis / Content Discovery (bulk traffic estimation) | **$0.012 flat per task + $0.00012 per returned item** — batch large rather than looping small calls; 1000 targets in one call costs $0.132 | `src/worker/dataforseo/labs.ts` (`BULK_TRAFFIC_ESTIMATION_PRICE_PER_TASK_USD`, `..._PER_ITEM_USD`) |
| Site Audit | Basic crawl **$0.00015/page** ($0.15 per 1000 pages); with JS rendering enabled, **10× that** ($0.0015/page); plus one flat **$0.005** Lighthouse run per audit (homepage only in v1) | `src/worker/dataforseo/on-page.ts` (`ON_PAGE_PRICE_PER_PAGE_USD`, `ON_PAGE_PRICE_PER_PAGE_JS_USD`, `LIGHTHOUSE_PRICE_PER_TASK_USD`) |
| AI Visibility | Live run: **$0.0006 base fee + whatever the underlying LLM/web-search actually costs**, passed through — measured examples range from ~$0.0008 (answered from training data, no search) to ~$0.03 (a forced web search that fetched real pages) | `src/shared/ai.ts` (`AI_LIVE_BASE_FEE_USD`), `src/worker/dataforseo/ai.ts` |
| Keyword Research, Backlinks | No fixed constant in this codebase — the client records whatever `cost` DataForSEO's own response reports | `src/worker/dataforseo/client.ts` |

Two things blunt all of the above in practice: **caching** (DataForSEO
responses are cached per workspace — 7 to 30 days depending on endpoint, see
`docs/ARCHITECTURE.md` — so a repeat lookup costs nothing) and the **spend
cap** (`workspaces.spend_cap_usd`, $25/month by default on a new workspace,
`0` to block every paid call, checked before every request in
`src/worker/dataforseo/client.ts`; exceeding it is an HTTP 402
`spend_cap_exceeded`, not a surprise bill). `GET /api/v1/usage` and the
Settings page show exactly what's been spent.

## Troubleshooting

### `wrangler secret put APP_MASTER_KEY` / decryption errors

`APP_MASTER_KEY` must be **32 bytes as hex — exactly 64 hex characters**.
`openssl rand -hex 32` produces the right shape. `openssl rand -base64 32` is
the more common recipe for "a random key" and an easy mistake to reach for
instead, but its output is the wrong length and alphabet — regenerate with
`-hex` if that's what you used.

While we're on the subject: the Cloudflare Workers runtime hard-caps PBKDF2 at
100,000 iterations (`NotSupportedError` above that — it's the platform
maximum, not a tunable), which is what OpenRefs uses for password hashing
(`src/worker/lib/crypto.ts`, `PBKDF2_ITERATIONS`). Local dev (`workerd` via
the Vite plugin) does **not** enforce this cap, so a fork that raises the
constant will pass every local test and then fail in production. Not
something you need to act on — just worth knowing if you're auditing the
crypto and it looks low.

### `db:migrate:remote` did nothing to my production database

Fixed as of commit `8e632db` (`fix(scripts): db:migrate:remote actually
targets remote`) — `wrangler d1 migrations apply` defaults to your **local**
database unless you pass `--remote`, and an earlier version of this script's
`package.json` entry was missing that flag, so a production migration had
silently not applied. If you forked this repo before that fix, check your
`package.json`:

```jsonc
"db:migrate:remote": "wrangler d1 migrations apply openrefs-db --remote"
```

If yours is missing `--remote`, add it — then re-run `npm run db:migrate:remote`
and confirm your remote schema actually has the tables you expect
(`npx wrangler d1 execute openrefs-db --remote --command "select name from sqlite_master where type='table'"`).

### My local D1 data disappeared

Wrangler keys locally-persisted D1 data off the `database_id` in
`wrangler.jsonc` (stored under the git-ignored `.wrangler/` directory — see
`.gitignore`). If that id changes — you re-ran `setup-cloudflare.sh` against
a different Cloudflare account, hand-edited `wrangler.jsonc`, or pulled a
teammate's config with a different id — wrangler starts you on a fresh, empty
local database rather than "resetting" your old one, which is still on disk
under the old id. Nothing is lost; re-run `npm run db:migrate:local` against
the new id to get a usable schema again.

### DataForSEO is slow or hangs

Observed in production (documented in `docs/BACKLOG.md` and
`src/worker/dataforseo/client.ts`): for minutes at a time, every `POST`-family
DataForSEO call (Labs, `on_page` task posts) from a Cloudflare Worker can hang
past its timeout, while the identical authenticated call answers in under a
second from a residential or non-Workers network. `GET` calls (like
`user_data`/balance) are unaffected, and the windows clear on their own.
Leading theory: DataForSEO rate-limits by source IP, and Cloudflare Workers
egress IPs are shared across many unrelated tenants, so another tenant's load
can poison the shared IP for everyone on it.

Two mitigations already in this codebase, and one you can add yourself:

- **Stale-if-error caching** ships by default: cached DataForSEO responses
  carry a soft TTL rather than a hard one, so when a refresh times out
  (specifically an upstream timeout — never a spend-cap or credential
  refusal, and never on a request that explicitly asked to bypass the cache)
  the stale copy is served with `stale: true` instead of an error.
- Retry ladders (`ATTEMPT_TIMEOUTS_MS`, `PATIENT_ATTEMPT_TIMEOUTS_MS` in
  `src/worker/dataforseo/client.ts`) already give slow-but-legitimate calls a
  second attempt.
- If it's frequent enough to matter for your deployment, point
  `DFS_PROXY_URL`/`DFS_PROXY_TOKEN` at your own relay on a clean IP — see
  [Optional configuration](#optional-configuration) above. Most self-hosted,
  lower-volume deployments won't hit this often enough to need it.
