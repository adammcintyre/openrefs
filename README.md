# OpenRefs

**Open-source SEO intelligence, powered by your own DataForSEO key.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-2E6F40.svg)](https://www.gnu.org/licenses/agpl-3.0)

An open-source alternative to tools like Ahrefs. You bring a DataForSEO API
key, OpenRefs turns it into a full SEO workbench, and you own both the data and
the bill.

> **Status: work in progress.** This is the Phase 0 scaffold. The application
> shell, database schema and API skeleton are in place; the research modules
> are not built yet. Nothing here is ready for production use.

## Why

Commercial SEO suites bundle the data with the interface and charge a
subscription for both. The underlying data is available directly from
[DataForSEO](https://dataforseo.com) at metered, pay-as-you-go rates — often a
fraction of a seat price for the volume one person actually uses.

OpenRefs is only the interface. It holds no data of its own and resells
nothing:

- **Your key, your account.** Credentials are stored per workspace, encrypted
  at rest with AES-256-GCM, and used only for your own requests.
- **Your bill.** Every call's cost is recorded, shown back to you, and capped
  by a spend limit you set. Responses are cached per workspace so repeat
  lookups are free.
- **Your infrastructure.** Self-host on Cloudflare's free plan, or let us host
  it.

## Features

Planned modules, in build order. Only the app shell and the health endpoint
exist today.

**Research — query anything, no setup required**

| Module | What it does |
| --- | --- |
| Keyword Research | Search volume, history, difficulty, intent and CPC; ideas, related terms and suggestions; keyword-to-SERP view; collections and CSV export |
| Domain Overview | Traffic estimate, Domain Score, top organic keywords, top pages, competitors, country split, paid search, history charts |
| Backlinks | Referring domains, anchors, new and lost links, history, Domain Score and Page Score |
| Gap Analysis | Keywords competitors rank for and you do not — multi-competitor, filterable, exportable, page-level too |
| Content Discovery | Topic search enriched with traffic estimates and referring domains, filtered for low competition |

**Projects — a site you own**

| Module | What it does |
| --- | --- |
| Rank Tracking | Daily positions by device and location, history charts, best page, SERP features, movers |
| Site Audit | Crawl for speed and Core Web Vitals, indexability, metadata, duplicates, links, redirects, images, robots, sitemaps and structured data |
| Search Console | Bind a Google Search Console property; striking-distance, low-CTR and cannibalisation reports |
| AI Visibility | Track mentions and citations of your site across AI engines over a set of prompts |

Domain Score and Page Score are OpenRefs' own 0–100 metrics, computed from
DataForSEO's backlink data. They are not any other vendor's metric.

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

## Self-hosting

### Local development

```bash
git clone https://github.com/adammcintyre/openrefs.git
cd openrefs
npm install

cp .dev.vars.example .dev.vars   # then fill in your values
npm run db:migrate:local         # create the local D1 schema
npm run dev                      # http://localhost:5173
```

`.dev.vars` is git-ignored and holds three values: `APP_MASTER_KEY` (generate
with `openssl rand -base64 32`), plus `DATAFORSEO_LOGIN` and
`DATAFORSEO_PASSWORD` as a development fallback. Never commit it.

### Deploying to your own Cloudflare account

```bash
npx wrangler login
./scripts/setup-cloudflare.sh    # creates D1/KV/R2 and writes the ids into wrangler.jsonc
```

The script then prints three `wrangler secret put` commands. Run all three —
deploys will fail without them — and then:

```bash
npm run deploy
```

### Scripts

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

## Bring your own DataForSEO key

OpenRefs ships no API key and proxies nobody else's. Sign up at
[dataforseo.com](https://dataforseo.com), top up whatever you want to spend,
and paste the login and password into your workspace settings. They are
encrypted with `APP_MASTER_KEY` before they touch the database.

From then on, every request OpenRefs makes on your behalf is billed to your
account and recorded against your workspace, with a spend cap you control and
per-workspace caching so the same lookup is never paid for twice.

## Licence

[AGPL-3.0-or-later](LICENSE). If you run a modified version as a network
service, you must offer its source to your users.

Trade marks referenced above belong to their respective owners and are used
only to describe what this project is comparable to.
