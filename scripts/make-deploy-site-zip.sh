#!/usr/bin/env bash
set -euo pipefail

# Usage: run from repo root: bash scripts/make-deploy-site-zip.sh
#
# Creates deploy-site.zip for extracting at public_html/midwaymusichall.net/.
# The archive contains frontend build files at the zip root and backend files
# under api/. It intentionally excludes api/.env* and api/uploads/.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/script-utils.sh"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-site-deploy.XXXXXX")"
STAGE_DIR="$TMP_DIR/site"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log_step "Step 1: Build frontend"
if [ ! -d "$ROOT_DIR/frontend" ]; then
  log_error "frontend/ directory not found. Aborting."
  exit 1
fi
pushd "$ROOT_DIR/frontend" >/dev/null
npm run build
popd >/dev/null

log_step "Step 2: Stage frontend build at site root"
if [ ! -d "$ROOT_DIR/frontend/build" ]; then
  log_error "frontend/build/ not found. Build the frontend first. Aborting."
  exit 1
fi
mkdir -p "$STAGE_DIR"
rsync -a \
  --exclude ".DS_Store" \
  "$ROOT_DIR/frontend/build/" "$STAGE_DIR/"

if [ -f "$ROOT_DIR/.htaccess" ]; then
  cp "$ROOT_DIR/.htaccess" "$STAGE_DIR/.htaccess"
else
  log_warn ".htaccess not found at repo root; deploy-site.zip will not include it."
fi

log_step "Step 3: Stage backend under api/ without secrets or uploads"
if [ ! -d "$ROOT_DIR/backend" ]; then
  log_error "backend/ directory not found. Aborting."
  exit 1
fi
mkdir -p "$STAGE_DIR/api"
rsync -a \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "uploads/" \
  --exclude ".DS_Store" \
  "$ROOT_DIR/backend/" "$STAGE_DIR/api/"

log_step "Step 4: Create deploy-site.zip"
rm -f "$ROOT_DIR/deploy-site.zip"
pushd "$STAGE_DIR" >/dev/null
zip -r --symlinks "$ROOT_DIR/deploy-site.zip" . -x "*.DS_Store" "*/.DS_Store"
popd >/dev/null

log_step "Step 5: Verification output"
ls -lh "$ROOT_DIR/deploy-site.zip"
log_info "--- deploy-site.zip listing (first ~40 lines) ---"
unzip -l "$ROOT_DIR/deploy-site.zip" | head -n 40 || true

log_success "Done. Created deploy-site.zip"
