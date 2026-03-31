#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

require_frontend_home_once || {
  log_error "frontend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

log_step "[public-surface] verifying direct-route availability"
for path in /privacy /terms /archive /thegatheringplace; do
  if ! curl -fsS --max-time 5 -H 'Accept: text/html' "$(frontend_url)${path}" >/dev/null; then
    log_error "[public-surface] expected ${path} to resolve through the frontend"
    exit 1
  fi
done

log_step "[public-surface] verifying evergreen base HTML"
if grep -Eqi 'December 2025|January 2026|Beach Bands 2026|beach bands 2026' "$ROOT_DIR/frontend/public/index.html"; then
  log_error "[public-surface] frontend/public/index.html still contains stale dated fallback content"
  exit 1
fi
if ! grep -q 'Live music, dance nights, and community events' "$ROOT_DIR/frontend/public/index.html"; then
  log_error "[public-surface] frontend/public/index.html is missing the evergreen venue description"
  exit 1
fi

log_step "[public-surface] verifying legal routes and sitemap entries"
node "$ROOT_DIR/scripts/legal-pages.mjs" verify
if ! grep -q '<loc>https://midwaymusichall.net/privacy</loc>' "$ROOT_DIR/frontend/public/sitemap.xml"; then
  log_error "[public-surface] sitemap missing /privacy entry"
  exit 1
fi
if ! grep -q '<loc>https://midwaymusichall.net/terms</loc>' "$ROOT_DIR/frontend/public/sitemap.xml"; then
  log_error "[public-surface] sitemap missing /terms entry"
  exit 1
fi
if ! grep -q 'href="/privacy"' "$ROOT_DIR/frontend/src/components/Footer.js"; then
  log_error "[public-surface] footer is not linking directly to /privacy"
  exit 1
fi
if ! grep -q 'href="/terms"' "$ROOT_DIR/frontend/src/components/Footer.js"; then
  log_error "[public-surface] footer is not linking directly to /terms"
  exit 1
fi
if ! grep -q "normalizedPath === '/privacy'" "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is missing direct /privacy route handling"
  exit 1
fi
if ! grep -q "normalizedPath === '/terms'" "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is missing direct /terms route handling"
  exit 1
fi

log_step "[public-surface] verifying skip-link and main landmarks"
if ! grep -q 'className="skip-link"' "$ROOT_DIR/frontend/src/components/Navigation.js"; then
  log_error "[public-surface] navigation is missing the skip link"
  exit 1
fi
for file in \
  "$ROOT_DIR/frontend/src/pages/LoginPage.js" \
  "$ROOT_DIR/frontend/src/pages/HomePage.js" \
  "$ROOT_DIR/frontend/src/pages/GatheringPlacePage.js" \
  "$ROOT_DIR/frontend/src/pages/ArchivePage.js" \
  "$ROOT_DIR/frontend/src/components/LegalDocumentPage.js" \
  "$ROOT_DIR/frontend/src/admin/AdminPanel.js"; do
  if ! grep -q 'id="main"' "$file"; then
    if ! grep -q 'id="admin-main"' "$file"; then
      log_error "[public-surface] missing main landmark id in ${file}"
      exit 1
    fi
  fi
done
if ! grep -q 'className="skip-link"' "$ROOT_DIR/frontend/src/pages/LoginPage.js"; then
  log_error "[public-surface] login page is missing the skip link"
  exit 1
fi
if ! grep -q 'className="skip-link"' "$ROOT_DIR/frontend/src/admin/AdminPanel.js"; then
  log_error "[public-surface] admin panel is missing the skip link"
  exit 1
fi
if ! grep -q 'id="main"' "$ROOT_DIR/frontend/public/index.html"; then
  log_error "[public-surface] frontend/public/index.html is missing the fallback main landmark id"
  exit 1
fi
if ! grep -q 'href="#main" class="skip-link"' "$ROOT_DIR/frontend/public/index.html"; then
  log_error "[public-surface] frontend/public/index.html is missing the fallback skip link"
  exit 1
fi
if grep -q '© 2026 Midway Music Hall' "$ROOT_DIR/frontend/public/index.html"; then
  log_error "[public-surface] frontend/public/index.html still contains a year-bound footer"
  exit 1
fi

log_success "[public-surface] verification succeeded"
