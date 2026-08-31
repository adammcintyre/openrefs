# OpenRefs

**Open-source SEO intelligence, powered by your own DataForSEO key.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-2E6F40.svg)](https://www.gnu.org/licenses/agpl-3.0)

An open-source alternative to tools like Ahrefs. You bring a DataForSEO API
key, OpenRefs turns it into a full SEO workbench, and you own both the data
and the bill.

**Status: v0.9.0, all nine modules live** — five ad-hoc research tools plus
four project-scoped modules, listed below, plus password reset and optional
transactional email (console by default, SendGrid when configured). v0.9.0
added the research workflow round: per-workspace search history with $0
cached reopening and explicit paid Refresh, in-page keyword drill-down tabs,
backlink spam/authority controls, a live spend widget, and a rank overview
chart. Billing for the hosted plan is the one piece still landing;
self-hosting is complete.

## Philosophy

Commercial SEO suites bundle the data with the interface and charge a
subscription for both. The underlying data is available directly from
[DataForSEO](https://dataforseo.com) at metered, pay-as-you-go rates — often a
fraction of a seat price for the volume one person actually uses. OpenRefs is
only the interface. It holds no data of its own and resells nothing:

- **Bring your own key.** DataForSEO credentials are stored per workspace,
  encrypted at rest with AES-256-GCM, and used only for that workspace's own
  requests — never pooled, never shared across tenants.
- **Cost transparency.** Every call's real cost is recorded and shown back to
  you, capped by a spend limit you control. Responses are cached per
  workspace so a repeat lookup is free, not re-billed.
- **No data resale.** Whether you self-host or use the hosted instance,
  OpenRefs never sells, mines, or repackages what your key pulls back. Your
  DataForSEO account, your data, your bill.

## Features

**Research — query anything, no setup required**

| Module | What it does |
| --- | --- |
| Keyword Research | Search volume, history, difficulty, intent and CPC, plus ideas, related terms and suggestions |
| Domain Overview | Traffic estimate, Domain Score, top organic keywords, top pages and competitors for any domain |
| Backlinks | Referring domains, anchors, new and lost links, and history for any target |
| Gap Analysis | Keywords your competitors rank for and you do not, across multiple domains |
| Content Discovery | Topic search enriched with traffic estimates and referring domains, filtered for low competition |

**Projects — a site you own**

| Module | What it does |
| --- | --- |
| Rank Tracking | Daily positions for tracked keywords by device and location, with movers and SERP features |
| Site Audit | Crawl your site for speed, indexability, metadata, duplicates, links and structured data issues |
| Search Console | Bind a Google property and surface striking-distance, low-CTR and cannibalisation reports |
| AI Visibility | Track whether AI engines mention and cite your site across a set of prompts |

Domain Score and Page Score are OpenRefs' own 0–100 metrics, computed from
DataForSEO's backlink data. They are not any other vendor's metric.

## API & MCP

Everything the OpenRefs interface can do, it does through a public JSON API —
and everything that API can do, an AI agent can do through the same server's
built-in MCP endpoint. Both authenticate with the same workspace API key
(`Authorization: Bearer orf_...`, minted in Settings → API Keys) and are bound
by the same permissions and spend cap as everything else in the workspace —
there's no separate quota hiding behind either surface. The REST API is
described by a hand-maintained OpenAPI 3.1 document at
`GET /api/v1/openapi.json`; `POST /mcp` (alias for `POST /api/v1/mcp`)
implements a stateless Streamable HTTP MCP server exposing keyword, domain,
backlink, gap-analysis, content-discovery, collection and project tools as
thin adapters over that same API. `/developers` on any running instance has
copy-paste `curl` and MCP client-config examples built against that
instance's own URL.

## Run it yourself, or let us run it

Identical features either way — the hosted plan buys you not having to
operate it, never access to your data or your API credits.

| | Self-host | Hosted |
| --- | --- | --- |
| Cost | Free, forever | Around $10/month per workspace |
| Where | Your own Cloudflare account | Ours |
| Updates & backups | Yours to run (see below) | Managed |
| Members per workspace | Unlimited | Unlimited |
| Your DataForSEO key | Yes — always | Yes — never resold or marked up |
| Code | AGPL-3.0: read it, change it, run your fork | Same codebase as self-host |

## Self-hosting

Fits Cloudflare's free Workers plan by design — no Queues, no Durable
Objects. Quickstart for local development:

```bash
git clone https://github.com/adammcintyre/openrefs.git
cd openrefs
npm install

cp .dev.vars.example .dev.vars   # git-ignored — then fill in real values
npm run db:migrate:local         # create the local D1 schema
npm run dev                      # http://localhost:5173
```

`.dev.vars` needs one value to run anything: `APP_MASTER_KEY`, a 32-byte hex
key (`openssl rand -hex 32` — it must be hex, not base64) that encrypts
DataForSEO credentials at rest. Everything else in there — a dev-fallback
DataForSEO login, Google OAuth for Search Console, the optional DataForSEO
egress relay — is optional and documented inline.

Deploying to your own Cloudflare account is `npx wrangler login`, then
`./scripts/setup-cloudflare.sh` (creates your D1/KV/R2 and prints the one
`wrangler secret put` command you need), then `npm run deploy`.

**The full walkthrough — production deploy, a custom domain, the optional
Search Console / egress-relay config, updating, backups, real DataForSEO
per-call costs, and the troubleshooting notes for the sharp edges we've
actually hit — is [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md).**

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite plus the Workers runtime, with local D1, KV and R2 |
| `npm run check` | Typecheck every tsconfig project |
| `npm run test` | vitest |
| `npm run build` | Production build of the client and the Worker |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate:local` | Apply migrations to the local database |
| `npm run db:migrate:remote` | Apply migrations to the deployed database |
| `npm run types` | Regenerate Worker binding types from `wrangler.jsonc` |
| `npm run deploy` | Build, then deploy to Cloudflare |

## Stack

One Cloudflare Worker serves both the JSON API and the React SPA.

- **Worker** — Hono, TypeScript strict, zod validation
- **Database** — D1 (SQLite) via Drizzle ORM
- **Cache** — Workers KV, keyed per workspace
- **Blobs** — R2, for raw audit data and exports
- **Frontend** — React, Vite, Tailwind v4, react-router, TanStack Query and
  Table, Recharts
- **Background work** — cron triggers over a `jobs` table in D1

No Queues and no Durable Objects, deliberately: everything runs on the
Cloudflare free plan.

## Licence

[AGPL-3.0-or-later](LICENSE). If you run a modified version as a network
service, you must offer its source to your users — that's the one obligation
that comes with self-hosting a fork rather than running this one as-is.

Trade marks referenced above belong to their respective owners and are used
only to describe what this project is comparable to.
