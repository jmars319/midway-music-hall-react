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
for path in /privacy /terms /archive /thegatheringplace /lessons /recurring /access-denied /temporarily-unavailable /maintenance /something-went-wrong; do
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
if ! grep -q "'/lessons': 'lessons'" "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is missing direct /lessons route handling"
  exit 1
fi
if ! grep -q "'/recurring': 'recurring-events'" "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is missing direct /recurring route handling"
  exit 1
fi
if ! grep -q 'requestedSection={sectionRouteTarget}' "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is not passing the direct section target into HomePage"
  exit 1
fi
if ! grep -q 'return <NotFoundPage' "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is missing branded not-found route handling"
  exit 1
fi
if ! grep -q 'ErrorDocument 404 /404.html' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing branded 404 ErrorDocument handling"
  exit 1
fi
if ! grep -q 'ErrorDocument 403 /403.html' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing branded 403 ErrorDocument handling"
  exit 1
fi
if ! grep -q 'ErrorDocument 500 /500.html' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing branded 500 ErrorDocument handling"
  exit 1
fi
if ! grep -q 'ErrorDocument 503 /503.html' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing branded 503 ErrorDocument handling"
  exit 1
fi
if ! grep -q 'maintenance.enable' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing the maintenance mode toggle"
  exit 1
fi
if ! grep -q "!\\^/payment" "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess maintenance mode is not preserving payment status routes"
  exit 1
fi
if ! grep -Fq 'RewriteRule ^$ index.html [L]' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing the explicit public root rewrite"
  exit 1
fi
if ! grep -Fq 'RewriteRule ^(privacy|terms|archive|thegatheringplace|lessons|recurring|recurring-events|login|admin|dashboard|access-denied|temporarily-unavailable|maintenance|something-went-wrong|server-error)/?$ index.html [L,NC]' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing explicit public SPA/status route allowlist"
  exit 1
fi
if ! grep -Fq 'RewriteRule ^payment(?:/.*)?$ index.html [L,NC]' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing explicit payment route allowlist"
  exit 1
fi
if ! grep -Fq 'RewriteRule . - [R=404,L]' "$ROOT_DIR/.htaccess"; then
  log_error "[public-surface] .htaccess is missing true 404 fallback for unknown public paths"
  exit 1
fi
if ! grep -q 'BrandImage' "$ROOT_DIR/frontend/src/components/BrandedStatusPage.js"; then
  log_error "[public-surface] BrandedStatusPage is missing MMH logo branding"
  exit 1
fi
if ! grep -q 'We couldn’t find that page\.' "$ROOT_DIR/frontend/src/pages/NotFoundPage.js"; then
  log_error "[public-surface] branded React not-found page copy is missing"
  exit 1
fi
if ! grep -q 'Lessons are not currently published\.' "$ROOT_DIR/frontend/src/pages/HomePage.js"; then
  log_error "[public-surface] HomePage is missing branded lessons-unavailable direct-route handling"
  exit 1
fi
if ! grep -q 'Recurring events are not currently published\.' "$ROOT_DIR/frontend/src/pages/HomePage.js"; then
  log_error "[public-surface] HomePage is missing branded recurring-unavailable direct-route handling"
  exit 1
fi
if ! grep -q "badge: 'Access denied'" "$ROOT_DIR/frontend/src/pages/SiteStatusPage.js"; then
  log_error "[public-surface] route-level access denied page copy is missing"
  exit 1
fi
if ! grep -q "badge: 'Temporarily unavailable'" "$ROOT_DIR/frontend/src/pages/SiteStatusPage.js"; then
  log_error "[public-surface] route-level temporarily unavailable page copy is missing"
  exit 1
fi
if ! grep -q "badge: 'Something went wrong'" "$ROOT_DIR/frontend/src/pages/SiteStatusPage.js"; then
  log_error "[public-surface] route-level server error page copy is missing"
  exit 1
fi
if ! grep -q "'/access-denied': 'access-denied'" "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is missing /access-denied route handling"
  exit 1
fi
if ! grep -q "'/temporarily-unavailable': 'temporarily-unavailable'" "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is missing /temporarily-unavailable route handling"
  exit 1
fi
if ! grep -q "'/something-went-wrong': 'something-went-wrong'" "$ROOT_DIR/frontend/src/App.js"; then
  log_error "[public-surface] App.js is missing /something-went-wrong route handling"
  exit 1
fi
if ! grep -q 'Midway Music Hall' "$ROOT_DIR/frontend/public/404.html"; then
  log_error "[public-surface] frontend/public/404.html is missing MMH branding"
  exit 1
fi
if ! grep -q 'Go Home' "$ROOT_DIR/frontend/public/404.html"; then
  log_error "[public-surface] frontend/public/404.html is missing a home action"
  exit 1
fi
for page in 403 500 503; do
  if ! grep -q 'Midway Music Hall' "$ROOT_DIR/frontend/public/${page}.html"; then
    log_error "[public-surface] frontend/public/${page}.html is missing MMH branding"
    exit 1
  fi
  if ! grep -q 'Go Home' "$ROOT_DIR/frontend/public/${page}.html"; then
    log_error "[public-surface] frontend/public/${page}.html is missing a home action"
    exit 1
  fi
done

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
