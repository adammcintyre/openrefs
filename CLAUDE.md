# OpenRefs — agent conventions

OpenRefs is an open-source (AGPL-3.0) SEO intelligence platform powered by the user's own DataForSEO API key. Self-hostable on Cloudflare's free plan, or hosted by us (~$10/m, bring-your-own key). Full context: `docs/ARCHITECTURE.md` (stack, data model, rules) and `docs/PLAN.md` (phases). Read both before working.

## Commands

- `npm run dev` — local dev (Vite + Cloudflare Workers runtime, local D1/KV/R2)
- `npm run check` — typecheck (must pass before any commit)
- `npm run test` — vitest
- `npm run build` — production build
- `npm run db:generate` / `npm run db:migrate:local` — Drizzle migrations

## Hard rules

1. **Secrets:** never commit credentials. Local secrets live in `.dev.vars` (git-ignored). Never hardcode API keys, never log them, never write them into docs/tests/fixtures.
2. **Trademarks:** never use Ahrefs product names or metrics. Banned terms in UI/code/docs: "Site Explorer", "Keywords Explorer", "Content Explorer", "Content Gap", "Domain Rating", "DR", "UR", "Domain Authority", "DA", "PageRank". Our terms: Domain Overview, Keyword Research, Content Discovery, Gap Analysis, Rank Tracking, Site Audit, **Domain Score / Page Score** (0–100).
3. **Free-plan compatible:** no Cloudflare Queues, no Durable Objects, no paid-only primitives. Background work = cron triggers + the `jobs` table in D1.
4. **Every DataForSEO call** goes through `src/worker/dataforseo/client.ts` — never call their API directly. The client handles auth, KV caching (TTL table in ARCHITECTURE.md), cost metering into `api_usage`, and spend-cap enforcement.
5. **API-first:** every feature is a `/api/v1/*` endpoint (Hono + zod validation) consumed by the SPA. Error shape: `{ "error": { "code": string, "message": string } }` with proper HTTP status.
6. **Deletion is a feature:** any new table storing workspace data must be reachable from the workspace deletion cascade (FK with cascade or explicit cleanup in the deletion routine), and KV/R2 keys must be prefixed `ws:<workspaceId>:` so they can be purged.

## Conventions

- TypeScript strict everywhere; shared types in `src/shared/`.
- Worker code in `src/worker/`, React SPA in `src/app/`, Drizzle schema in `src/db/`.
- UI: Tailwind v4 with the Lush Forest tokens (defined in `src/app/styles/theme.css`); light + dark modes; Recharts for charts; TanStack Query for data fetching; react-router for routing.
- Commit style: conventional-ish (`feat:`, `fix:`, `chore:`, `docs:`), small logical commits. Never `git push` and never deploy unless your brief explicitly says to.
- Verify before reporting done: `npm run check && npm run test && npm run build` all green.
