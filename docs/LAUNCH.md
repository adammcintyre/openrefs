# Pre-public-launch checklist

The concrete, actionable version of `docs/specs/PHASE8.md` §8e's launch list.
"Public launch" here means: the repository goes public and the hosted
instance at `openrefs.adamm.io` starts accepting signups from people who
aren't us.

Each item names **who** does it — **Adam** (needs his own accounts/access:
GitHub billing, the DataForSEO account, Google Cloud console, SendGrid,
Stripe) or the **orchestrator** (repo-side changes any agent session can
make) — and whether it's a **hard requirement** before flipping the switch or
a **nice-to-have** that can follow shortly after.

## Hard requirements

### 1. Rotate the DataForSEO account password — Adam

The credentials used for development have lived in `.dev.vars` across many
local and agent sessions. Before the repo is public and the hosted instance
takes real signups, rotate that account's password (and if the login/password
pair itself needs to change, update the local `.dev.vars` fallback — never
committed, so this is a local + `wrangler secret` concern only, not a code
change). This is separate from any individual workspace's own DataForSEO
credentials, which self-hosters and hosted users each bring themselves and
which this rotation does not touch.

### 2. `APP_MASTER_KEY` rotation stance — documented here, decision is Adam's

**Stance: rotating `APP_MASTER_KEY` is acceptable, and does not need a
migration path before launch.**

What actually happens if it's rotated (verified against the code, not
assumed):

- Every workspace's stored DataForSEO credentials, and every project's stored
  Google Search Console refresh token, are AES-256-GCM ciphertext under the
  **old** key. They are not deleted or corrupted — they simply stop
  decrypting.
- The Settings page still reports DataForSEO credentials as `configured:
  true` after a rotation (`src/worker/routes/workspaces.ts`: a decryption
  failure "still reports `configured: true` — the operator needs to know
  something is stored — but reveals nothing about it"). The failure surfaces
  the moment a call actually tries to use them: `resolveWorkspaceCredentials`
  (`src/worker/dataforseo/credentials.ts`) throws `internal_error` with the
  message *"Stored DataForSEO credentials could not be decrypted. Re-enter
  them in Settings."*
- Search Console connections fail the same way and are marked broken
  (`src/worker/gsc/tokens.ts`), which the UI already surfaces as a reconnect
  prompt.

Net effect: **rotating the key does not silently break anything or leak
anything — it makes every previously-stored secret unusable, with a clear,
specific, actionable error message, and the fix is "re-enter it."** No code
change is required to make rotation safe; this section *is* the documentation
the spec asked for. If Adam wants to rotate `APP_MASTER_KEY` before or at
launch (reasonable, given the same reasoning as item 1 — it's lived in
`.dev.vars` across many sessions), the cost is: every workspace that has
already saved DataForSEO credentials or connected Search Console before the
rotation will need to redo that one step after it. For a pre-launch instance
with only test data in it, that cost is close to zero.

### 3. GitHub Actions billing → CI green → delete the diagnostic files — Adam + orchestrator

Per `docs/BACKLOG.md`: GitHub Actions is currently blocked by an account
billing lock (Adam's side; nothing in the repo can fix this).

1. **Adam** clears the billing lock on the `adammcintyre` GitHub account.
2. **Orchestrator** confirms `.github/workflows/ci.yml` runs and goes green
   (`npm ci && npm run check && npm run test && npm run build` on push/PR to
   any branch — see the workflow file).
3. **Orchestrator** deletes `.github/workflows/smoke.yml` — it's a
   deliberately minimal diagnostic ("the smallest possible workflow. If this
   also fails to start, the problem is the account/repo") that was only ever
   meant to isolate the billing-lock question and has no reason to ship.
4. **Adam** deletes the throwaway repository `adammcintyre/actions-probe`
   (used to isolate the same question at the account level; not part of this
   codebase, so only Adam can remove it).

### 4. Flip the repository public — Adam

After item 3 is fully done (billing unlocked, CI green, both diagnostics
removed) — not before, since a public repo with red CI or leftover
probe-artifacts is a worse first impression than a slightly later launch.

### 5. Tag `v1.0.0` — orchestrator, Adam signs off

Two files carry the version literal and both need to move together
(`src/shared/version.ts`: *"Bump it alongside package.json's `version`."*):

- `package.json` → `"version"`
- `src/shared/version.ts` → `APP_VERSION`

Both currently read `0.7.0` (Content Discovery / Phase 7, all nine modules
live). Bump both to `1.0.0` in the same commit, then tag it. `APP_VERSION` is
what `GET /api/v1/health` reports and what the OpenAPI document
(`GET /api/v1/openapi.json`) echoes as its `info.version` — so a mismatch
between the two files is externally visible, not just cosmetic.

### 6. `/privacy` contact address — Adam

`src/app/routes/privacy.tsx` has an explicit, self-flagged TODO:

> OPERATOR TODO before hosted launch: `CONTACT_HREF` below points at the
> repository's issue tracker, which is honest but impersonal. Replace it with
> a real contact address for the hosted service — Google's consent screen
> review expects one, and so do data-subject requests.

Concretely: `CONTACT_HREF` (currently `${GITHUB_URL}/issues`) needs a real
contact — an email address or a contact page — before Google's OAuth
verification review (item 7) and before the page is fully honest for anyone
making a data-subject request against the hosted instance.

### 7. Google OAuth verification submission — Adam

Per `docs/specs/PHASE5.md`'s operator prerequisites, ahead of this:

1. Google Cloud project → OAuth consent screen (External), app name
   "OpenRefs", scope `https://www.googleapis.com/auth/webmasters.readonly`
   only, privacy policy URL `https://openrefs.adamm.io/privacy`.
2. OAuth client (Web application), redirect URI
   `https://openrefs.adamm.io/api/v1/gsc/callback`, wired into
   `GOOGLE_CLIENT_ID` (wrangler.jsonc var) + `GOOGLE_CLIENT_SECRET`
   (`wrangler secret put`).
3. **Submit for verification** once the instance moves past the 100-test-user
   cap that an unverified "Testing" consent screen enforces — i.e. before any
   member of the public (rather than a handful of explicitly-added testers)
   can be expected to connect Search Console. Item 6 (a real contact address)
   should land first — reviewers check it.

`GOOGLE_CLIENT_ID` in `wrangler.jsonc` is currently empty, so this whole
module is still pending its first real credential as of this writing
(`docs/PLAN.md`: "Google OAuth client pending operator setup").

## Blocked on work that hasn't shipped yet

### 8. SendGrid domain authentication — Adam, once email sends at all

`docs/specs/PHASE8.md` §8c scopes `EMAIL_PROVIDER` (`console` default vs
`sendgrid`), `SENDGRID_API_KEY`, and `EMAIL_FROM`, covering invite emails and
password-reset. **None of this exists in the codebase yet** — there is no
`src/worker/lib/email.ts`, no SendGrid reference anywhere in `src/`, and no
password-reset route (`src/worker/routes/auth.ts` only has
`register`/`login`/`logout`/`me`). Invites today are link-based only (copy
the link from Settings → Members); there is no self-service password reset
at all.

This item can't be actioned until §8c ships. Once it does: authenticate
whatever sending domain `EMAIL_FROM` uses in SendGrid (SPF/DKIM), so invite
and reset emails don't land in spam. **Hard requirement once §8c ships and
before relying on it for real users; not actionable today.**

### 9. Stripe go-live — Adam + orchestrator, when billing ships

`docs/specs/PHASE8.md` §8d scopes `BILLING_ENABLED` (default off — self-host
never sees this), Stripe Checkout + Billing Portal, and a
$10/month-per-workspace / 14-day-trial default model. **No Stripe code exists
in this repo yet** — no `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` reference
anywhere in `src/`, no `stripeCustomerId`/`subscriptionStatus` columns. The
hosted instance currently has no billing enforcement of any kind: every
workspace, including the operator's, runs on whatever spend cap it sets,
uncapped by any subscription check.

**Nice-to-have relative to this launch** — the spec explicitly frames this as
"Adam confirms the business defaults before enabling billing in production,"
and PHASE8.md's own split notes it should be "build + unit-test regardless"
of whether Adam's Stripe keys are available yet. When it does ship, go-live
is: Adam confirms the $10/mo, unlimited-members, 14-day-trial model (or
changes it), supplies live Stripe keys, `BILLING_ENABLED` flips on for the
hosted deployment only (self-host stays off by default), and workspace
deletion is confirmed to cancel the Stripe subscription and delete the
customer (the spec calls out that this "fills the Phase-0 TODO in
`lib/deletion.ts`" — worth a direct check once the code exists, not just a
read of the spec).

## Nice-to-have (not launch-blocking)

### 10. DataForSEO support ticket — Adam

Filed as a backlog item, not yet sent as of this writing. Exact text drafted
in `docs/BACKLOG.md`, ready to send as-is:

> Our app calls your live API from Cloudflare Workers. Requests from Workers
> egress IPs intermittently hang for minutes (all POST endpoints; GETs
> unaffected) while the same authenticated calls are instant from other
> networks — consistent with per-IP throttling on shared cloud egress. Can
> our account (team@brandpacks.com) be rate-limited by auth rather than
> source IP, or the Workers ranges allowlisted?

This doesn't block launch — the product already mitigates the symptom
(stale-if-error caching, described in `docs/SELF-HOSTING.md`'s
troubleshooting section) — but a fix on DataForSEO's side would remove the
slow windows at the source rather than just papering over them. Worth sending
regardless of launch timing.
