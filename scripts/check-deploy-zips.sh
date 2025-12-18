#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

if [ "$#" -ne 0 ]; then
  echo "Usage: bash scripts/check-deploy-zips.sh" >&2
  exit 2
fi

BACKEND_ZIP=deploy-backend.zip
FRONTEND_ZIP=deploy-frontend.zip

echo "Checking existence of deploy zips..."
[ -f "$BACKEND_ZIP" ] || fail "$BACKEND_ZIP not found in repo root"
[ -f "$FRONTEND_ZIP" ] || fail "$FRONTEND_ZIP not found in repo root"

list_and_brief() {
  local z=$1
  echo "--- $z (brief listing) ---"
  # show first ~40 lines and the final totals line from unzip -l
  unzip -l "$z" | { head -n 40; echo '...'; unzip -l "$z" | tail -n 1; } || true
}

echo
list_and_brief "$BACKEND_ZIP"
echo
list_and_brief "$FRONTEND_ZIP"

# Use unzip -Z1 to get one-file-per-line list for checks
zip_list() {
  unzip -Z1 "$1"
}

echo
echo "Running content checks..."

# Backend checks
backend_names=$(zip_list "$BACKEND_ZIP")

# 1) No .env files anywhere
if printf "%s\n" "$backend_names" | grep -E -q '(^|/)\.env($|[./])'; then
  fail "$BACKEND_ZIP contains .env files (forbidden)"
fi

# 2) No uploads/ anywhere
if printf "%s\n" "$backend_names" | grep -E -q '(^|/)uploads/'; then
  fail "$BACKEND_ZIP contains uploads/ entries (forbidden)"
fi

# 3) No .DS_Store anywhere
if printf "%s\n" "$backend_names" | grep -E -q '(^|/)\.DS_Store$'; then
  fail "$BACKEND_ZIP contains .DS_Store (forbidden)"
fi

# 4) Must include index.php at top level
if ! printf "%s\n" "$backend_names" | grep -xq 'index.php'; then
  fail "$BACKEND_ZIP must contain index.php at the archive root"
fi

echo "OK: $BACKEND_ZIP passed basic checks"

# Frontend checks
frontend_names=$(zip_list "$FRONTEND_ZIP")

# a) Must include index.html at top level
if ! printf "%s\n" "$frontend_names" | grep -xq 'index.html'; then
  fail "$FRONTEND_ZIP must contain index.html at the archive root"
fi

# b) Must include .htaccess at top level
if ! printf "%s\n" "$frontend_names" | grep -xq '\.htaccess'; then
  fail "$FRONTEND_ZIP must contain .htaccess at the archive root"
fi

# c) Must include static/ entries (files or dir)
if ! printf "%s\n" "$frontend_names" | grep -E -q '^static(/|$)'; then
  fail "$FRONTEND_ZIP must contain files under static/"
fi

# d) Must not contain .DS_Store
if printf "%s\n" "$frontend_names" | grep -E -q '(^|/)\.DS_Store$'; then
  fail "$FRONTEND_ZIP contains .DS_Store (forbidden)"
fi

echo "OK: $FRONTEND_ZIP passed basic checks"

echo
echo "All checks passed."
