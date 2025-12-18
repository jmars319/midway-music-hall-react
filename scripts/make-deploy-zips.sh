#!/usr/bin/env bash
set -euo pipefail

# Usage: run from repo root: bash scripts/make-deploy-zips.sh

echo "Step 1: Safety checks and removing old deployment zips"
# Remove existing deployment zips (explicit names and legacy patterns)
rm -f backend-deploy.zip frontend-deploy.zip frontend-build.zip \
      deploy-backend.zip deploy-frontend.zip \
      backend-deploy-*.zip frontend-deploy-*.zip deploy-*.zip || true

echo "Step 2: Create deploy-backend.zip (backend files at zip root)"
if [ ! -d backend ]; then
  echo "Error: backend/ directory not found. Aborting."
  exit 1
fi
pushd backend >/dev/null
# Zip backend contents at the zip root. Exclude .env* files, uploads/, and .DS_Store
zip -r --symlinks ../deploy-backend.zip . -x "*.env*" "*/.env*" "uploads/*" "uploads/**" "*.DS_Store" "*/.DS_Store"
popd >/dev/null

echo "Step 3: Create deploy-frontend.zip (include frontend/build/ contents + .htaccess at zip root)"
if [ ! -d frontend/build ]; then
  echo "Error: frontend/build/ not found. Build the frontend first. Aborting."
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
  echo "Warning: .htaccess not found at repo root; deploy-frontend.zip will not include it."
fi

echo "Step 4: Verification output"
ls -lh deploy-backend.zip deploy-frontend.zip || true

echo "--- deploy-backend.zip listing (first ~30 lines) ---"
unzip -l deploy-backend.zip | head -n 30 || true

echo "--- deploy-frontend.zip listing (first ~30 lines) ---"
unzip -l deploy-frontend.zip | head -n 30 || true

echo "Done. Created deploy-backend.zip and deploy-frontend.zip"
