# Midway Music Hall – Pre-Deployment Checklist

Use this sheet right before uploading to GoDaddy. All steps assume the site lives in `public_html/midwaymusichall.net/` and the backend resides in `/api`.

---

## Build + code sanity
- [ ] `npm install && npm run lint`
- [ ] `npm run build` (output: `frontend/build/`)
- [ ] `php -l backend/index.php backend/bootstrap.php backend/lib/Emailer.php`
- [ ] `.htaccess` (repo root) reviewed – includes HTTPS + `/api` + `/uploads` + SPA fallback
- [ ] `backend/.env.production.example` updated locally with the keys we expect to set in production

## Files to upload
- [ ] Copy **contents** of `frontend/build/` into `public_html/midwaymusichall.net/`
- [ ] Copy entire `backend/` folder to `public_html/midwaymusichall.net/api/`
- [ ] Upload the root `.htaccess` to `public_html/midwaymusichall.net/.htaccess`
- [ ] Ensure `api/uploads/` exists and permissions allow PHP writes (775)
- [ ] Confirm no other `.htaccess` files remain in subfolders (avoid conflicts)

## Environment & safety
- [ ] Create `public_html/midwaymusichall.net/api/.env` using the production example
- [ ] Double-check DB host/name/user/password entries
- [ ] `APP_ENV=production`
- [ ] `SEND_EMAILS=false` (we only enable after live testing)
- [ ] `CORS_ALLOW_ORIGIN=https://midwaymusichall.net`
- [ ] `ADMIN_SESSION_COOKIE_SECURE=true`
- [ ] Save `.env` with permissions 640 (or equivalent)

## Database creation/import (phpMyAdmin)
- [ ] Create DB + user in cPanel “MySQL Databases” and grant full privileges
- [ ] In phpMyAdmin → select the new DB → Import `database/20250320_full_seed_nodb.sql`
- [ ] Run compat migrations from `DB_DEPLOY.md` if phpMyAdmin warns about unsupported clauses
- [ ] Execute verification queries from `DB_DEPLOY.md` (categories, audit log, recurrence counts)
- [ ] Update `.env` with the created DB credentials

## Cloudflare / DNS
- [ ] Domain added to Cloudflare, nameservers pointed from GoDaddy
- [ ] A records (`@`, `www`) → GoDaddy server IP, proxied (orange cloud)
- [ ] SSL mode set to **Full** (or Full Strict)
- [ ] “Always Use HTTPS” + “Automatic HTTPS Rewrites” enabled
- [ ] Brotli + Auto Minify enabled, Rocket Loader disabled

## GoDaddy hosting checks
- [ ] `public_html/midwaymusichall.net/` contains build output + `api/`
- [ ] Folder permissions 755; files 644
- [ ] `.htaccess` visible (enable “show hidden files” in File Manager)
- [ ] `api/uploads/` is writable
- [ ] PHP version matches local (8.x) and has required extensions (curl, json, mysqli)

## Final verification before switching DNS / announcing launch
- [ ] Visit `https://midwaymusichall.net` (or temporary preview URL) – hero + sections load
- [ ] `/thegatheringplace` renders with correct seating buttons
- [ ] `/api/health` (or similar endpoint) responds 200 without exposing sensitive info
- [ ] `/admin` login works; Events, Categories, Site Content, Seat Requests, Audit Log all load
- [ ] `[email:skip]` entries appear in backend logs when triggering seat-request actions
- [ ] `robots.txt`, `sitemap.xml`, and `manifest.json` resolve
- [ ] Run the steps in `DEPLOY_SMOKE_TEST.md` (document each pass/fail)

If any box remains unchecked, pause deployment and resolve the blocker first. Keep SEND_EMAILS disabled until the team explicitly decides to test live emails.
