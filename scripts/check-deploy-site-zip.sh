#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/script-utils.sh"

fail() {
  log_error "$1"
  exit 1
}

if [ "$#" -ne 0 ]; then
  log_error "Usage: bash scripts/check-deploy-site-zip.sh"
  exit 2
fi

SITE_ZIP="$ROOT_DIR/deploy-site.zip"

log_step "Checking existence of deploy-site.zip..."
[ -f "$SITE_ZIP" ] || fail "deploy-site.zip not found in repo root"

log_info "--- deploy-site.zip (brief listing) ---"
unzip -l "$SITE_ZIP" | { head -n 50; echo '...'; unzip -l "$SITE_ZIP" | tail -n 1; } || true

zip_names="$(unzip -Z1 "$SITE_ZIP")"

log_step "Running content checks..."

require_entry() {
  local entry="$1"
  if ! printf "%s\n" "$zip_names" | grep -xq "$entry"; then
    fail "deploy-site.zip must contain ${entry}"
  fi
}

require_prefix() {
  local prefix="$1"
  if ! printf "%s\n" "$zip_names" | grep -E -q "^${prefix}(/|$)"; then
    fail "deploy-site.zip must contain entries under ${prefix}/"
  fi
}

require_entry "index.html"
require_entry ".htaccess"
require_prefix "static"
require_entry "api/index.php"
require_entry "api/bootstrap.php"
require_prefix "api/lib"

if printf "%s\n" "$zip_names" | grep -E -q '(^|/)\.env($|[./])'; then
  fail "deploy-site.zip contains .env files (forbidden)"
fi

if printf "%s\n" "$zip_names" | grep -E -q '^api/uploads/'; then
  fail "deploy-site.zip contains api/uploads/ entries (forbidden)"
fi

if printf "%s\n" "$zip_names" | grep -E -q '(^|/)\.DS_Store$'; then
  fail "deploy-site.zip contains .DS_Store (forbidden)"
fi

if printf "%s\n" "$zip_names" | grep -E -q '(^|/)node_modules/'; then
  fail "deploy-site.zip contains node_modules/ entries (forbidden)"
fi

if printf "%s\n" "$zip_names" | grep -E -q '^(backend|frontend)/'; then
  fail "deploy-site.zip should not contain repo-level backend/ or frontend/ folders"
fi

log_success "deploy-site.zip passed single-archive checks"
