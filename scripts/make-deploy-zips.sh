#!/usr/bin/env bash
set -euo pipefail

# Usage: run from repo root: bash scripts/make-deploy-zips.sh

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/script-utils.sh"

log_step "Step 1: Build frontend"
if [ ! -d "$ROOT_DIR/frontend" ]; then
  log_error "frontend/ directory not found. Aborting."
  exit 1
fi
pushd "$ROOT_DIR/frontend" >/dev/null
npm run build
popd >/dev/null

log_step "Step 2: Safety checks and removing old deployment zips"
# Remove existing deployment zips (explicit names and legacy patterns)
rm -f backend-deploy.zip frontend-deploy.zip frontend-build.zip \
      deploy-backend.zip deploy-frontend.zip \
      backend-deploy-*.zip frontend-deploy-*.zip deploy-*.zip || true

log_step "Step 3: Create deploy-backend.zip (backend files at zip root)"
if [ ! -d backend ]; then
  log_error "backend/ directory not found. Aborting."
  exit 1
fi
pushd backend >/dev/null
# Zip backend contents at the zip root. Exclude .env* files, uploads/, and .DS_Store
zip -r --symlinks ../deploy-backend.zip . -x "*.env*" "*/.env*" "uploads/*" "uploads/**" "*.DS_Store" "*/.DS_Store"
popd >/dev/null

log_step "Step 4: Create deploy-frontend.zip (include frontend/build/ contents + .htaccess at zip root)"
if [ ! -d frontend/build ]; then
  log_error "frontend/build/ not found. Build the frontend first. Aborting."
  exit 1
fi
pushd frontend/build >/dev/null
# Add all build files into the zip (zip root will contain the build contents)
zip -r ../../deploy-frontend.zip . -x "*.DS_Store" "*/.DS_Store"
popd >/dev/null

# Add repo root .htaccess at the top level of the frontend zip (do not change its name)
if [ -f .htaccess ]; then
  # -j strips path so the file is placed at zip root
  zip -j deploy-frontend.zip .htaccess
else
  log_warn ".htaccess not found at repo root; deploy-frontend.zip will not include it."
fi

log_step "Step 5: Verification output"
ls -lh deploy-backend.zip deploy-frontend.zip || true

log_info "--- deploy-backend.zip listing (first ~30 lines) ---"
unzip -l deploy-backend.zip | head -n 30 || true

log_info "--- deploy-frontend.zip listing (first ~30 lines) ---"
unzip -l deploy-frontend.zip | head -n 30 || true

log_success "Done. Created deploy-backend.zip and deploy-frontend.zip"
