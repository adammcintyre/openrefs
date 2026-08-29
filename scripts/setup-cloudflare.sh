#!/usr/bin/env bash
#
# One-time Cloudflare provisioning for an OpenRefs deployment.
#
#   1. Creates the D1 database, KV namespace and R2 bucket if they are missing.
#   2. Patches the real resource ids into wrangler.jsonc (comments preserved).
#   3. Prints the `wrangler secret put` commands you must run yourself.
#   4. Applies migrations to the remote database.
#
# Safe to re-run: every step is a no-op when the resource already exists.
#
# Requires a logged-in wrangler (`npx wrangler login`). This script never
# handles your secrets — it only tells you which commands to run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${REPO_ROOT}/wrangler.jsonc"

D1_NAME="openrefs-db"
KV_BINDING="CACHE"
R2_BUCKET="openrefs-blobs"

WRANGLER=(npx --no-install wrangler)

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

[ -f "$CONFIG" ] || die "wrangler.jsonc not found at ${CONFIG}"
command -v node >/dev/null 2>&1 || die "node is required"

# Reads a JSON array on stdin and prints the value of <idField> for the object
# whose <matchField> equals <value>. Avoids a jq dependency.
json_lookup() {
  node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d)).on("end", () => {
      const [matchField, value, idField] = process.argv.slice(1);
      let list = [];
      try { list = JSON.parse(raw); } catch { list = []; }
      if (!Array.isArray(list)) list = [];
      const hit = list.find((entry) => entry && entry[matchField] === value);
      process.stdout.write(hit ? String(hit[idField] ?? "") : "");
    });
  ' "$1" "$2" "$3"
}

bold "OpenRefs — Cloudflare setup"

if ! "${WRANGLER[@]}" whoami >/dev/null 2>&1; then
  die "wrangler is not authenticated. Run: npx wrangler login"
fi

# ---------------------------------------------------------------------------
# 1. D1
# ---------------------------------------------------------------------------
bold "D1 database (${D1_NAME})"

d1_id="$("${WRANGLER[@]}" d1 list --json 2>/dev/null | json_lookup name "$D1_NAME" uuid || true)"

if [ -z "$d1_id" ]; then
  info "not found — creating"
  create_out="$("${WRANGLER[@]}" d1 create "$D1_NAME" 2>&1 || true)"
  d1_id="$(printf '%s' "$create_out" |
    grep -Eoi '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' |
    head -1 || true)"
  [ -n "$d1_id" ] || {
    printf '%s\n' "$create_out" >&2
    die "could not determine the new database id"
  }
  info "created ${d1_id}"
else
  info "exists ${d1_id}"
fi

# ---------------------------------------------------------------------------
# 2. KV
# ---------------------------------------------------------------------------
bold "KV namespace (${KV_BINDING})"

# wrangler titles namespaces "<worker-name>-<binding>".
kv_title="openrefs-${KV_BINDING}"
kv_id="$("${WRANGLER[@]}" kv namespace list 2>/dev/null | json_lookup title "$kv_title" id || true)"

if [ -z "$kv_id" ]; then
  info "not found — creating"
  create_out="$("${WRANGLER[@]}" kv namespace create "$KV_BINDING" 2>&1 || true)"
  kv_id="$(printf '%s' "$create_out" | grep -Eo '[0-9a-f]{32}' | head -1 || true)"
  [ -n "$kv_id" ] || {
    printf '%s\n' "$create_out" >&2
    die "could not determine the new KV namespace id"
  }
  info "created ${kv_id}"
else
  info "exists ${kv_id}"
fi

# ---------------------------------------------------------------------------
# 3. R2
# ---------------------------------------------------------------------------
bold "R2 bucket (${R2_BUCKET})"

if "${WRANGLER[@]}" r2 bucket info "$R2_BUCKET" >/dev/null 2>&1; then
  info "exists"
else
  info "not found — creating"
  "${WRANGLER[@]}" r2 bucket create "$R2_BUCKET" >/dev/null ||
    die "could not create the R2 bucket"
  info "created"
fi

# ---------------------------------------------------------------------------
# 4. Patch wrangler.jsonc
# ---------------------------------------------------------------------------
bold "Writing ids into wrangler.jsonc"

# Anchored on the surrounding keys so the comment lines between them survive,
# which a JSON round-trip would strip.
D1_ID="$d1_id" KV_ID="$kv_id" node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const before = fs.readFileSync(path, "utf8");

  let after = before.replace(
    /("database_name"\s*:\s*"openrefs-db"[\s\S]*?"database_id"\s*:\s*")[^"]*(")/,
    (_m, head, tail) => head + process.env.D1_ID + tail,
  );
  after = after.replace(
    /("binding"\s*:\s*"CACHE"[\s\S]*?"id"\s*:\s*")[^"]*(")/,
    (_m, head, tail) => head + process.env.KV_ID + tail,
  );

  if (!after.includes(process.env.D1_ID) || !after.includes(process.env.KV_ID)) {
    console.error("error: could not patch wrangler.jsonc — edit it by hand.");
    process.exit(1);
  }

  if (after === before) {
    console.log("  already up to date");
  } else {
    fs.writeFileSync(path, after);
    console.log("  updated");
  }
' "$CONFIG"

# ---------------------------------------------------------------------------
# 5. Secrets — the operator runs these, not this script
# ---------------------------------------------------------------------------
bold "Secrets you must set yourself"
cat <<'EOF'
  These are prompted for interactively so they never touch your shell history,
  this repository, or a CI log. Run all three:

    npx wrangler secret put APP_MASTER_KEY
    npx wrangler secret put DATAFORSEO_LOGIN
    npx wrangler secret put DATAFORSEO_PASSWORD

  APP_MASTER_KEY encrypts workspace DataForSEO credentials at rest.
  Generate one with:  openssl rand -base64 32
EOF

# ---------------------------------------------------------------------------
# 6. Remote migrations
# ---------------------------------------------------------------------------
bold "Applying migrations to the remote database"
"${WRANGLER[@]}" d1 migrations apply "$D1_NAME" --remote

bold "Done"
cat <<'EOF'
  Next:
    1. Set the three secrets above (deploys will fail without them).
    2. npm run types    # regenerate Env types
    3. npm run deploy
EOF
