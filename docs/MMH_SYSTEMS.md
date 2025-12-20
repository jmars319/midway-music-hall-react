# Executive Summary
- Midway Music Hall (MMH) runs a React single-page application backed by a PHP router so the public site (`frontend/src/components/*`, legacy landing preserved in `frontend/archive/SinglePageLanding.js`) and API (`backend/index.php`) stay in one monorepo.
- Interactive seating requests let guests pick seats and submit contact info from the same modal that calls `/api/seating/event/:id` (frontend/src/components/EventSeatingModal.js) and the PHP routes at `backend/index.php:3263-3739` handle seating layouts, reservations, and email routing.
- Staff operate a modular admin SPA with dashboards, events, seat requests, and media management (`frontend/src/admin/AdminPanel.js`, `DashboardModule.js`, `SeatRequestsModule.js`, `MediaManager.js`) which all talk to authenticated endpoints such as `/api/dashboard-stats`, `/api/seat-requests`, and `/api/media` (`backend/index.php:3522-4281`).
- The image and media pipeline turns uploads into responsive optimized/WebP variants (`backend/lib/ImageUtils.php`, `/api/media` routes) and the React components consume those manifests via `ResponsiveImage.js` and `imageVariants.js`.
- Branding assets are hardcoded with deterministic srcsets (`frontend/src/components/BrandImage.js`, `frontend/src/apiConfig.js`) so the logo/default event art never depends on CMS state; `useSiteContent.js` caches copy but always falls back to these assets.
- Seat availability, locking, and layout snapshots live in backend helpers like `detect_seat_conflicts`, `apply_seat_reservations`, and `create_seat_request_record` (`backend/index.php:1582-1833`), giving MMH enterprise-style concurrency guarantees.
- Performance and caching rely on `.htaccess` rewrite/caching rules (`.htaccess:4-94`) plus CRA build flags such as `GENERATE_SOURCEMAP=false` in `frontend/.env` to keep bundles immutable and small.
- Security controls include upload directory execution bans (`backend/uploads/.htaccess`), global security headers in `.htaccess`, and deploy zips that explicitly exclude `.env` and `uploads/` per `scripts/make-deploy-zips.sh` and `scripts/check-deploy-zips.sh`.
- SEO/robots constraints are explicit in `frontend/public/robots.txt` and sitemap entries (`frontend/public/sitemap.xml`), and fallback HTML lives in `frontend/public/index.html` for crawlers.
- Deployment is zip-based: `deploy-backend.zip` contains PHP minus secrets/uploads, `deploy-frontend.zip` includes build output plus the root `.htaccess` (scripts/make-deploy-zips.sh), and the layout is enforced by `DEPLOYMENT_GUIDE.md`.

# System Inventory (Table)
| System/Module Name | Purpose (1 sentence) | Users | Frontend surfaces | Backend surfaces | Data/storage | Key risks/failure modes | Monitoring/diagnostics available |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Seating & Reservation Engine | Provides interactive seating layouts, holds, approvals, and routing for events. | both | `EventSeatingModal.js`, `SeatingChart.js`, `SeatRequestsModule.js`, `hooks/useSeatDebug.js` | `/api/seating/event/:eventId`, `/api/seat-requests*`, helpers `detect_seat_conflicts`/`create_seat_request_record` in `backend/index.php:1500-3928`. | Tables `seating_layouts`, `seating_layout_versions`, `seat_requests`, JSON seat snapshots. | Seat conflicts, stale holds, missing contact data. | Seat debug logging (hooks/useSeatDebug.js), admin status filters, audit log (`backend/index.php:2589`). |
| Responsive Image & Media Pipeline | Generates optimized/WebP variants and supplies responsive `<picture>` elements. | both | `ResponsiveImage.js`, `imageVariants.js`, `MediaManager.js`, `FeaturedEvents.js`, `Hero.js`. | `/api/media` CRUD (`backend/index.php:4155-4281`), processors in `backend/lib/ImageUtils.php`. | Files under `backend/uploads/variants/*`, manifest JSON, `media` table. | Legacy `/uploads` links 404, failed variant generation on shared hosting. | Media progress UI (MediaManager.js:250-360), `backend/scripts/check_image_variants.php`. |
| Brand & Site Content Layer | Serves deterministic logos/default event icons and cached business content. | both | `BrandImage.js`, `Navigation.js`, `useSiteContent.js`, fallback static HTML (`frontend/public/index.html`). | `/api/site-content` (`backend/index.php:4303-4429`). | `business_settings` seeded files, `frontend/public/iconslogos/*`. | CMS changes conflicting with hardcoded assets, stale cached copy. | LocalStorage cache + `primeBrandingCache` (useSiteContent.js) and manual invalidation. |
| Admin Console & Audit Logging | Gives staff dashboards, CRUD tools, and activity visibility. | admin | `AdminPanel.js`, `DashboardModule.js`, `SeatRequestsModule.js`, `EventsModule.js`. | `/api/dashboard-stats`, `/api/audit-log`, `/api/events`, `/api/seat-requests`. | Tables `events`, `audit_log`, `seat_requests`, `media`. | Session drift, missing visibility into destructive actions. | Dashboard refresh + `/api/audit-log` feed (DashboardModule.js), audit entries via `record_audit` (`backend/index.php:1462-1490`). |
| Deployment & Routing Stack | Packages frontend/backend assets and enforces routing/caching on Apache/Cloudflare. | operators | N/A (scripts + `.htaccess`). | `.htaccess`, `backend/.htaccess`, scripts in `/scripts`. | Zips `deploy-frontend.zip`, `deploy-backend.zip`; `.env` on server; uploads dir. | Mis-packaged zips, missing `.htaccess`, stale caches. | `scripts/check-deploy-zips.sh` validation, `DEPLOYMENT_GUIDE.md` smoke tests. |
| SEO + Robots & Static Fallback | Controls crawl behavior and provides static content for bots/non-JS browsers. | public | `frontend/public/robots.txt`, `frontend/public/sitemap.xml`, `frontend/public/index.html` fallback. | Served as static files via `.htaccess` caching exemptions. | Static files in `frontend/public`. | Blocking search or leaving AI-block rules out of sync. | Manual verification; `.htaccess` forces no-cache on manifest/robots (lines 67-85). |

# Detailed Systems
## Seating & Reservation Engine
### What it does (plain English)
Keeps the public seating modal, admin seat-request queue, and backend reservation state in sync so guests can request seats, staff can approve/deny, and layouts stay accurate (`frontend/src/components/EventSeatingModal.js`, `frontend/src/admin/SeatRequestsModule.js`).
### How it works (technical flow: request/response + state + data shape)
The modal fetches `/api/seating/event/${event.id}` to get rows, reservedSeats, pendingSeats, stage metadata, and canvas settings before rendering (`EventSeatingModal.js` fetch in useEffect). Seat clicks call `filterUnavailableSeats` and `resolveSeatDisableReason` (`frontend/src/utils/seatAvailability.js`) so the UI blocks seats flagged as `reserved` or `pending`. Submissions post to `/api/seat-requests` (`backend/index.php:3739-3814`), where `create_seat_request_record` normalizes payloads, requires seat IDs/contact info, locks existing requests (`detect_seat_conflicts` uses `FOR UPDATE`, `backend/index.php:1582-1631`), sets hold expirations (`compute_hold_expiration`), snapshots the layout (`snapshot_layout_version`), and optionally applies reservations immediately via `apply_seat_reservations` when status is `confirmed` (`backend/index.php:1645-1665`). Admin workflows hit `/api/seat-requests` (list/filter) and the approve/deny routes at `/api/seat-requests/:id/approve|deny` (`backend/index.php:3666-3738`).
### Where it lives in the code (file paths + key identifiers)
- React modal + seat chart: `frontend/src/components/EventSeatingModal.js`, `frontend/src/components/SeatingChart.js`.
- Seat availability utilities: `frontend/src/utils/seatAvailability.js`, debug hook `frontend/src/hooks/useSeatDebug.js`.
- Admin queue and manual reservation UI: `frontend/src/admin/SeatRequestsModule.js`.
- Backend router entries `/api/seating*` and `/api/seat-requests*`: `backend/index.php:3263-3928`.
### Operational notes (deployment, caching, maintenance, logging)
Seat debug logging uses `useSeatDebugLogger` with `?debugSeats=1` or localStorage flag to emit console traces (`frontend/src/hooks/useSeatDebug.js`). Backend automatically expires holds by scanning `seat_requests` (function `expire_stale_holds`, `backend/index.php:1520-1537`). Audit entries are recorded via `record_audit('seat_request.*', ...)` on mutations (`backend/index.php:3614-3735`). Layout migrations and admin instructions are documented in `SEATING_LAYOUT_SYSTEM.md`, and admins can click “Apply latest layout template” in the event editor to call `POST /api/events/:id/refresh-layout` whenever templates change.
### Known edge cases + mitigations (only if verified)
- Events without `layout_id`/`layout_version_id` are rejected with `event_not_seating_enabled` to prevent invalid reservations (`backend/index.php:1745-1750`).
- Seat conflicts respond with `409` and list conflicting seat IDs (`SeatRequestException 'seat_conflict'` in `create_seat_request_record`), and the admin UI surfaces those messages via `getAdminReservationFailureMessage` (`frontend/src/utils/reservationReasonMessages.js`).

## Responsive Image & Media Pipeline
### What it does (plain English)
Ensures every event/hero/media asset has responsive variants while providing upload/preview tooling and automatic fallbacks.
### How it works
`MediaManager` uploads files via `POST /api/media` with XHR progress, shows processing states, and lists categorized media (`frontend/src/admin/MediaManager.js:250-360`). `/api/media` routes (`backend/index.php:4155-4281`) call `process_image_variants` (`backend/lib/ImageUtils.php`) to read intrinsic dimensions, resize into `/uploads/variants/{optimized,webp}`, and persist manifest metadata (width, height, srcset strings). `ResponsiveImage` builds `<picture>` elements from variant data or raw `src`, merges sizes and aspect ratio constraints, and swaps to fallback icons on errors (`frontend/src/components/ResponsiveImage.js`). The site now guards against legacy `/uploads/event-*` URLs by running `hasRenderableImageVariant` inside `imageVariants.js` and components such as `FeaturedEvents.js`, `Schedule.js`, and `Hero.js` to avoid emitting broken `<img>` tags.
### Where it lives
Frontend components: `ResponsiveImage.js`, `frontend/src/components/FeaturedEvents.js`, `frontend/src/components/Hero.js`, `frontend/src/components/Schedule.js`, `frontend/src/pages/ArchivePage.js`. Backend processing: `backend/lib/ImageUtils.php`, `/api/media` routes. Validation script: `backend/scripts/check_image_variants.php`.
### Operational notes
Uploads live under `backend/uploads/` and are excluded from version control per `.gitignore` and `make-deploy-zips.sh`. Staff can audit variant health with `backend/scripts/check_image_variants.php`. Hero and beach images come from CMS settings, but `Hero.js` filters them via `hasRenderableImageVariant` to prevent fallback flicker.
### Known edge cases + mitigations
If WebP generation is unsupported on the host, `process_image_variants` records notes and still serves optimized PNG/JPEG. Legacy hero/event URLs are now dropped before rendering, replacing them with the default event icon to prevent 404s.

## Brand & Site Content Layer
### What it does
Provides deterministic logos/default imagery and cached copy for navigation, hero text, lessons, and contact blocks, independent of CMS branding toggles.
### How it works
`BrandImage.js` defines `logo` and `defaultEvent` variants with explicit PNG/WebP srcsets and fallbacks, and exports `DEFAULT_EVENT_ICON_SRC` for consumers like `MediaManager` and `ResponsiveImage` (`frontend/src/components/BrandImage.js`). `apiConfig.js` exposes `getImageUrl`/`getImageUrlSync` helpers that fall back to `/iconslogos/*` assets whenever an `image_url` is missing or relative (`frontend/src/apiConfig.js:32-68`). `useSiteContent.js` fetches `/api/site-content`, merges results with `DEFAULT_CONTENT`, stores them in localStorage, and re-primes branding caches so the SPA always has a baseline even if the API fails (`frontend/src/hooks/useSiteContent.js`). Static HTML/OG metadata inside `frontend/public/index.html` mirrors this content for crawlers.
### Where it lives
Frontend: `frontend/src/components/BrandImage.js`, `frontend/src/apiConfig.js`, `frontend/src/hooks/useSiteContent.js`, `frontend/public/iconslogos/*`. Backend: `/api/site-content` route (`backend/index.php:4303-4429`) that pulls from `business_settings` tables populated by SQL seeds (`database/20250320_full_seed.sql`).
### Operational notes
Brand assets live under `frontend/public/iconslogos` and must be rebuilt/deployed via the zip process. `useSiteContent` exposes `invalidateSiteContentCache` so admin updates can flush local caches.
### Known edge cases + mitigations
If CMS hero images reference deleted uploads, `Hero.js` sees `hasRenderableImageVariant` return false and falls back to gradient + CTA copy, preventing empty hero sections.

## Admin Console & Audit Logging
### What it does
Gives staff a dashboard with stats, quick navigation, event CRUD, seat request triage, and audit visibility.
### How it works
`DashboardModule.js` fetches `/api/dashboard-stats` and `/api/audit-log?limit=6` to render stat cards and recent activity, with refresh actions that repeat those fetches (`frontend/src/admin/DashboardModule.js`). `SeatRequestsModule.js` calls `/api/seat-requests` and uses `getSeatReasonMessage` plus `getAdminReservationFailureMessage` to highlight rejection causes (`frontend/src/utils/reservationReasonMessages.js`). Event cards display seat routing, layout info, and preview thumbnails using `ResponsiveImage` and `getImageUrlSync` (`frontend/src/admin/EventsModule.js:680-760`). Backend `record_audit` writes to `audit_log` for seat request status changes, category edits, etc. (`backend/index.php:1462-1490`), and `/api/audit-log` exposes entries with filtering/pagination (`backend/index.php:2589-2659`).
### Where it lives
Frontend admin modules under `frontend/src/admin/*`. Backend API routes `/api/dashboard-stats`, `/api/audit-log`, `/api/events`, `/api/seat-requests`, `/api/media`. Database tables `audit_log`, `events`, `seat_requests`.
### Operational notes
All admin fetches send `credentials: 'include'`. Dashboard stats help confirm API health after deploy, and audit entries are critical for troubleshooting, so the `audit_log` table must exist (see `backend/index.php:2589-2605`).
### Known edge cases + mitigations
If the `audit_log` table is missing, the `/api/audit-log` route logs an error and returns a 500, which surfaces a banner in `DashboardModule` (catch block sets `activityError`).

## Deployment & Routing Stack
### What it does
Builds deployable zips, enforces Apache rewrites, and preserves immutable caches so Cloudflare/CDN hosting stays stable.
### How it works
`scripts/make-deploy-zips.sh` removes stale archives, zips backend files while excluding `.env*` and `uploads/`, zips `frontend/build/`, and injects the repo `.htaccess` into the frontend bundle. `scripts/check-deploy-zips.sh` validates that `deploy-backend.zip` lacks `.env`/`uploads` and that `deploy-frontend.zip` contains `index.html`, `.htaccess`, and `static/`. `.htaccess` rewrites `/uploads/*` to `api/uploads/*`, proxies `/api/*` to `api/index.php`, and falls back SPA routes to `index.html` while setting security + cache headers (lines 4-94). The backend `.htaccess` simply routes everything to `router.php`. `DEPLOYMENT_GUIDE.md` defines the cPanel layout so operators place frontend files in `public_html/midwaymusichall.net/` and backend files under `api/`, keeping `uploads/` writable.
### Where it lives
`scripts/` directory, `.htaccess`, `backend/.htaccess`, `DEPLOYMENT_GUIDE.md`.
### Operational notes
Always run lint/build/php-l before calling `make-deploy-zips.sh` and then `check-deploy-zips.sh` to catch packaging mistakes. Cloudflare should run in Full/Strict SSL per the deployment guide, and `.htaccess` already allows `/.well-known/` for certificate validation.
### Known edge cases + mitigations
If `.htaccess` is missing from the frontend zip, SPA routes break; `check-deploy-zips.sh` explicitly validates `.htaccess` inclusion so this fails fast. If uploads are inadvertently zipped, the script exits to prevent overwriting production assets.

## SEO + Robots & Static Fallback
### What it does
Controls which bots can crawl the site while ensuring non-JavaScript clients still get business details.
### How it works
`frontend/public/robots.txt` allows all search engines but disallows AI scrapers such as GPTBot, ChatGPT-User, CCBot, and Anthropics, and references `https://midwaymusichall.net/sitemap.xml`. `frontend/public/sitemap.xml` lists `/`, `/thegatheringplace`, and `/archive`. `frontend/public/index.html` contains canonical metadata, OG/Twitter tags, schema.org JSON-LD, and a static fallback body describing events/lessons so crawlers can index content without running React.
### Where it lives
Static files under `frontend/public`. `.htaccess` sets `Cache-Control: no-cache` on `manifest.json`, `robots.txt`, and `sitemap.xml` (lines 67-78) so updates propagate immediately.
### Operational notes
Update `sitemap.xml` whenever new public routes become canonical. Keep robots rules aligned with policy; because caching is disabled, these files update instantly after deploy.
### Known edge cases + mitigations
If Cloudflare cached robots in the past, the `.htaccess` no-cache headers now prevent stale versions. Missing sitemap entries simply reduce crawl coverage; there is no automated validation.

# Critical User Flows (step-by-step)
- **Public reservation flow**: Visitor opens an event card and clicks “Request Seats,” which mounts `EventSeatingModal` and fetches `/api/seating/event/:id` for layout data (frontend/src/components/EventSeatingModal.js). Seat selections are filtered via `filterUnavailableSeats` and errors shown via `showTransientError`. On submit, `/api/seat-requests` stores the request, snapshots the layout, and notifies staff (`backend/index.php:1733-1833`).
- **Admin manual reservation flow**: Staff open `SeatRequestsModule`, click the manual action, load admin-scoped events via `/api/events?scope=admin` (fetch in SeatRequestsModule). Submission sends a `POST /api/seat-requests` payload with `allow_status_override`, and backend locking (`detect_seat_conflicts`, `apply_seat_reservations`) ensures no double booking.
- **Seating layout + availability refresh flow**: Layout templates are managed via `/api/seating-layouts*` (routes at `backend/index.php:3426-3517`). Assigning a layout to an event lets `snapshot_layout_version` freeze it when the first request arrives. Reserved/pending seats are refetched whenever the modal opens or when admin changes status, and holds expire through `expire_stale_holds`.
- **Event creation + media upload + responsive variants flow**: Admin `EventsModule` uses `ResponsiveImage` to preview either the chosen `image_url` or fallback (`frontend/src/admin/EventsModule.js:680-760`). If new art is needed, `MediaManager` uploads files to `/api/media`, shows progress/processing states, and the backend generates variant manifests (`backend/lib/ImageUtils.php`). Events reference the resulting `image_variants` so `ResponsiveImage` can render responsive posters site-wide.
- **Site branding assets flow**: Navigation and hero components import `BrandImage` (e.g., `frontend/src/components/Navigation.js` and `Hero.js`). `BrandImage` loads hardcoded PNG/WebP srcsets, while `apiConfig.js` ensures any missing event image defaults to `/iconslogos/mmh-default-event@1x.png`. `useSiteContent` fetches contact/policy info but always merges with `DEFAULT_CONTENT` to maintain copy even if the API fails.
- **Audit logging / recent activity flow**: Admin dashboard fetches `/api/audit-log?limit=6` and renders timestamps (`frontend/src/admin/DashboardModule.js`). Backend calls `record_audit` whenever seat requests, categories, events, or settings change (`backend/index.php:2418-3735`), so admins can trace actions via the UI or raw API.

# Performance + Reliability
- **Caching strategy**: `.htaccess` sets immutable caching for JS/CSS/fonts (`FilesMatch "\.(js|css)$"` and `ExpiresByType application/javascript "access plus 1 year"`) while force-disabling cache for HTML/manifest/robots (lines 50-94). Cloudflare guidance in `DEPLOYMENT_GUIDE.md` (§7) enforces Full/Strict SSL and respects origin headers. CRA builds stay immutable because hashed filenames plus these headers remain stable.
- **PageSpeed mitigations**: Legacy `/uploads/event-*` URLs are filtered via `hasRenderableImageVariant` (`frontend/src/utils/imageVariants.js:172-224`), preventing Lighthouse 404 deductions. Source maps are disabled in production via `GENERATE_SOURCEMAP=false` in `frontend/.env`, reducing asset weight.
- **Concurrency/locking**: Seat mutations run inside database transactions; `detect_seat_conflicts` iterates `seat_requests` with `FOR UPDATE` locks and respects hold expirations (`backend/index.php:1582-1631`). Approved requests immediately call `apply_seat_reservations` to mark seats taken (lines 1645-1665), and `expire_stale_holds` reclaims seats.
- **Fallback strategies**: `BrandImage` ensures navigation/default imagery always exists (`frontend/src/components/BrandImage.js`), `ResponsiveImage` swaps to fallback sources when image loads fail (`frontend/src/components/ResponsiveImage.js` handler), and `Hero.js` filters hero arrays so empty slots fall back to gradient backgrounds.

# Security Posture (practical)
- **Uploads folder protections**: `backend/uploads/.htaccess` disables directory listings, blocks script execution via `Require all denied` for dangerous extensions, and sets cache headers (lines 1-26), preventing executable uploads.
- **API hardening patterns**: Seat routes validate payloads and throw descriptive `SeatRequestException`s when required fields are missing or invalid (`backend/index.php:1679-1755`). `/api/media` rejects uploads that fail variant generation and logs errors (`backend/index.php:4155-4281`).
- **Headers/CSP**: `.htaccess` sets `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`, and `Permissions-Policy` globally (lines 34-41), and removes `X-Powered-By`/`Server` headers.
- **Deliberately not done**: No service worker or CSP file exists; `.htaccess` comments only cover current headers, and `frontend/.env` disables CRA linting in builds rather than shipping advanced CSP.

# Deployment Model
- **What gets deployed**: `deploy-backend.zip` is generated from `backend/` without `.env*` or `uploads/` (`scripts/make-deploy-zips.sh`), while `deploy-frontend.zip` packages `frontend/build/` and injects the root `.htaccess`. The production layout described in `DEPLOYMENT_GUIDE.md` places the frontend build at `public_html/midwaymusichall.net/` and the backend in `api/` with `uploads/` left writable.
- **How deploy zips are created and verified**: Run `bash scripts/make-deploy-zips.sh` to build zips, then `bash scripts/check-deploy-zips.sh` to ensure backend zips contain `index.php` but no `.env`, `uploads/`, or `.DS_Store`, and that frontend zips include `index.html`, `.htaccess`, and `static/`.
- **What must be preserved on server**: `.env` and `api/uploads/` are intentionally excluded from zips (`scripts/make-deploy-zips.sh` exclusion patterns); `DEPLOYMENT_GUIDE.md §4-6` notes they must persist between releases so staff uploads and secrets survive redeploys.

# What changed recently (last 15 commits)
- `e84eddf chore(scripts): make deploy scripts executable and update gitignore` — Deployment tooling system.
- `b5f7e2b fix(frontend): ignore legacy /uploads images to prevent 404s and console errors` — Responsive image system.
- `4ba8cd1 feat(scripts): add deploy zip creation and verification scripts` — Deployment tooling.
- `506a4e6 chore(htaccess): harden caching and allow well-known paths` — Performance/security/routing.
- `2567de8 chore(git): stop tracking uploaded media` — Deployment/storage hygiene.
- `ae57b3d chore(git): stop ignoring env example files` — Config/deployment documentation.
- `4f69737 chore(git): ignore build output, deploy archives, and env files` — Repo hygiene supporting deployment.
- `5624db4 .htaccess: do not cache CRA/PWA metadata files (asset-manifest, manifest, robots, sitemap)` — Performance/SEO system.
- `5decd45 frontend(seating): centralize seat-availability logic, add debug logger, and update UI` — Seating engine + monitoring.
- `50c4c00 backend(seat-requests): add locking, transactions, and structured rejection logging` — Seating backend concurrency/logging.
- `a195cbb chore: commit local edits` — Mixed/unspecified (repository maintenance).
- `98e4939 refactor(branding): remove CMS image settings` — Brand/content system.
- `564694e feat(brand): hardcode nav logo and default icon` — Brand/content system.
- `72d4092 fix(frontend): responsive Schedule thumbnail; update Hero, ResponsiveImage and image variants` — Responsive image system.
- `388092c fix(backend): small image utils and bootstrap fixes` — Image pipeline/backend bootstrap.

# Operator Checklist
1. Keep `backend/uploads/` and `.env` files untracked; confirm `.gitignore` exclusions before committing (repo root `.gitignore`).
2. Run `npm run lint`, `npm run build`, and `php -l backend/index.php` prior to packaging (per `DEPLOYMENT_GUIDE.md §2`).
3. Execute `bash scripts/make-deploy-zips.sh` to regenerate `deploy-*.zip` and inspect its log output.
4. Immediately run `bash scripts/check-deploy-zips.sh` to ensure zipped artifacts contain/omit the right files.
5. Upload `deploy-frontend.zip` contents to `public_html/midwaymusichall.net/` and include the root `.htaccess` (guide §4).
6. Upload `deploy-backend.zip` into `public_html/midwaymusichall.net/api/`, leaving `api/uploads/` and `.env` untouched.
7. Verify Cloudflare is still set to Full or Full (Strict) SSL and purge cache after deploy (`DEPLOYMENT_GUIDE.md §7`).
8. Smoke test the public site (hero, schedule filters, seat request modal) and admin portal per `DEPLOYMENT_GUIDE.md §9`.
9. Hit `/api/health` or `/api/site-content` to confirm API connectivity before re-enabling emails.
10. Document outcomes in `DEPLOYMENT_STATUS.md` and archive the built zips for rollback.

# Next Best Improvements
1. Add a lightweight cron-compatible endpoint (or scheduled job) that calls `expire_stale_holds` regularly so seat release doesn’t depend solely on incoming traffic.
2. Extend `scripts/check-deploy-zips.sh` to produce checksums/signatures for the zips, improving deploy verification confidence.
3. Build a small admin page for brand assets so staff can preview/upload new logos while still writing files into `frontend/public/iconslogos` before the next build.
4. Add automated tests that validate `robots.txt` and `sitemap.xml` contents to prevent SEO regressions when new routes are introduced.
5. Instrument `/api/seating*` with structured logging around hold expirations and layout snapshots so concurrency issues can be debugged faster.
6. Create a Cloudflare purge helper script to automate cache invalidation after uploads.
7. Introduce optional source-map uploads to a private storage bucket so Lighthouse warnings can be cleared without exposing code in production.
8. Expose audit-log filtering (by actor/action) in the admin UI to speed investigations.
9. Surface media processing failures directly in `MediaManager` by polling `/api/media` for `processing_notes` so staff can act on issues.
10. Document the `debugSeats` workflow inside `SEATING_LAYOUT_SYSTEM.md` to make on-call troubleshooting easier.
