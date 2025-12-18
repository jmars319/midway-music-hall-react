# Midway Music Hall Deployment – GoDaddy cPanel + Cloudflare + phpMyAdmin

> **Canonical Notice:** This file is the single source of truth for deployments. `DEPLOY.md`, `DEPLOY_SMOKE_TEST.md`, and other historical docs remain for reference but are marked legacy—always start here.

The live stack is GoDaddy shared hosting (Apache/PHP) behind Cloudflare SSL. The production docroot is `public_html/midwaymusichall.net/`. Our React SPA lives at the root, and the PHP API is served from `/api`.

---

## 1. Target Layout (must match exactly)

```
public_html/
└── midwaymusichall.net/
    ├── index.html, asset-manifest.json, robots.txt, sitemap.xml, favicon*, manifest.json
    ├── static/ (hashed JS/CSS assets from frontend build)
    ├── api/                      ← copy of repo backend/ (see §4)
    │   ├── index.php, bootstrap.php, lib/, uploads/, vendor/
    │   └── .env                  ← production secrets (see §5)
    ├── uploads/                  ← served via rewrite to api/uploads/ (no PHP here)
    └── .htaccess                 ← repo root version (handles HTTPS, /api, /uploads, SPA fallback)
```

Rules:
1. React build output lives directly inside `public_html/midwaymusichall.net/`.
2. Backend code sits in `public_html/midwaymusichall.net/api/` (copy/paste the repo `backend/` folder, keep the name `api`).
3. `api/uploads/` must be writable (chmod 775 or use cPanel “change permissions”).
4. Only one `.htaccess` exists—root-level file shipped with the repo.

---

## 2. Pre-deploy checklist (local machine)

1. `npm install` (front-end dependencies)
2. `cd frontend && npm run lint && npm run build`
3. PHP syntax: `find backend -name "*.php" -print0 | xargs -0 -n1 php -l`
4. Confirm `.env.production.example` matches the secrets you plan to set.
5. Ensure `database/20250320_full_seed_nodb.sql` is ready for phpMyAdmin import.
6. Verify `.htaccess` is the repo copy (no local edits unless required).

---

## 3. Build the React app

```bash
cd frontend
npm run build
# Output: frontend/build/*
```

Zip the contents of `frontend/build/` (not the folder itself) for upload, or use cPanel’s directory upload.

---

## 4. Upload files to GoDaddy cPanel

1. GoDaddy → Hosting → **cPanel Admin** → **File Manager**.
2. Navigate to `public_html/` and create/enter `midwaymusichall.net/`.
3. (Recommended) Select all existing files in `midwaymusichall.net/`, click **Compress**, download the ZIP as a rollback backup.
4. Zip everything inside `frontend/build/` (contents only). Upload that ZIP into `public_html/midwaymusichall.net/`, select it, and click **Extract**. This keeps hashed filenames intact and mirrors prior successful deployments. Delete the ZIP after extraction.
5. Upload the root `.htaccess` into the same folder (show hidden files).
5. Upload the repo `backend/` folder, rename it to `api/` after uploading.
6. Set permissions:
   - Directories: 755 (apply recursively).
   - Files: 644.
   - `api/uploads/`: 775 or writeable via cPanel (PHP needs upload permission).

Uploads folder mapping: `.htaccess` already rewrites `/uploads/*` → `/api/uploads/*`, so no extra Apache config is needed.

---

## 5. Production environment variables

Location: `public_html/midwaymusichall.net/api/.env`

1. Copy `backend/.env.production.example` to `.env`.
2. Populate with production values:

```
APP_ENV=production
APP_KEY=generate_a_secret_key
APP_URL=https://midwaymusichall.net

DB_HOST=127.0.0.1
DB_NAME=midway_live
DB_USER=midway_user
DB_PASS=strong-password

SENDGRID_API_KEY=SG.xxxxxx
SEND_EMAILS=false             # keep false until live smoke test passes
STAFF_EMAIL_TO=midwayeventcenter@gmail.com
ALERTS_EMAIL_TO=support@jamarq.digital

CORS_ALLOW_ORIGIN=https://midwaymusichall.net
ADMIN_SESSION_COOKIE_SECURE=true
```

3. Permissions: 640 (owner + group). `.htaccess` blocks access but keep it private.
4. Only after production smoke tests pass should `SEND_EMAILS` be set to `true`.

---

## 6. Database creation + import (phpMyAdmin)

1. **Create DB + user** (cPanel → MySQL Databases):
   - Create database (e.g., `midway_live`).
   - Create user (e.g., `midway_user`), assign strong password.
   - Add user to DB with **All Privileges**.

2. **Import** using phpMyAdmin:
   - Select the new database.
   - Use **Import** → choose `database/20250320_full_seed_nodb.sql`.
   - Run import.

3. **Compatibility issues**:
   - If MariaDB rejects `ADD COLUMN IF NOT EXISTS` or other 5.7+ syntax, run `database/20251212_schema_upgrade_compat.sql` (already includes compatibility routines) using phpMyAdmin’s **Import** with “Allow multiple statements” turned on.
   - For timeouts, split the `_nodb` seed file into chunks (categories/events/seat maps) and import sequentially.

4. **Verification queries** (phpMyAdmin → SQL):
   - `SELECT COUNT(*) FROM events;` (expect 330+ seeded events)
   - `SELECT COUNT(*) FROM event_categories;` (should be ≥ 6 including Beach Bands)
   - `SELECT COUNT(*) FROM admin_users;` (should be 1 default admin to reset manually)
   - `SELECT COUNT(*) FROM seat_requests;` (seeded with 0)
   - `SELECT slug, COUNT(*) FROM events GROUP BY slug HAVING COUNT(*)>1;` (expect 0 duplicates)

5. Update `api/.env` DB credentials to match the new database/user.

6. If you must run migrations manually (e.g., data hotfixes), run `php -f api/cli/migrate.php` over SSH. Avoid phpMyAdmin for incremental migrations unless necessary.

---

## 7. Cloudflare + SSL configuration

1. **DNS**: In Cloudflare, add A records for `@` and `www` pointing to GoDaddy’s IP with orange-cloud proxy enabled.
2. **SSL/TLS**:
   - Set mode to **Full** or **Full (Strict)**. Never use Flexible (causes loops).
   - Enable **Always Use HTTPS** and **Automatic HTTPS Rewrites**.
3. **Edge settings**: Enable Brotli + Auto Minify (HTML/CSS/JS). Keep Rocket Loader OFF to avoid script issues.
4. **Caching**: “Standard” level, respect origin headers. Purge after each deploy.
5. cPanel/GoDaddy should keep AutoSSL enabled for the origin certificate (Cloudflare handles public cert).

---

## 8. Routing requirements (.htaccess summary)

The repo `.htaccess` enforces:
- HTTPS redirect (compatible with Cloudflare Full/Strict).
- `/api/*` → `api/index.php`.
- `/uploads/*` → `api/uploads/*`.
- SPA fallback: any non-file route rewrites to `index.html`.

If SPA routes (e.g., `/lessons`) return 404, ensure `.htaccess` is at `public_html/midwaymusichall.net/.htaccess` and not overridden by cPanel.

---

## 9. Post-deploy smoke test (staff-friendly)

1. **Public site**
   - Browse `https://midwaymusichall.net` on desktop + mobile.
   - Verify hero + “FIRST TIME HERE?” remain above the fold.
   - Check schedule month filter, pagination, and “Now” button.
   - In Beach Bands section, confirm contact info + Request Seats button show only for seating-enabled, non-recurring events.

2. **Admin portal**
   - Log into `/admin`.
   - Events list loads, editing works.
   - Site Content edit: change a social link or review URL, save, refresh public page to confirm update (cache should invalidate).

3. **API**
   - Hit `https://midwaymusichall.net/api/health` (or `/api/site-content`) and confirm JSON response without PHP errors.

4. **Emails**
   - Confirm log output shows `[email] skip` (SEND_EMAILS=false) during smoke test.
   - Only after all checks pass should SEND_EMAILS be set to `true` and a single test seat request submitted.

Document each step in `DEPLOYMENT_STATUS.md`.

---

## 10. Common issues / fixes

| Issue | Fix |
|-------|-----|
| **Cloudflare redirect loop** | Set Cloudflare SSL mode to **Full**/**Full (Strict)**, ensure `.htaccess` forces HTTPS once, and confirm cPanel AutoSSL is not redirecting separately. |
| **SPA routes 404** | Verify `.htaccess` resides in `public_html/midwaymusichall.net/`. Re-upload repo version. Clear Cloudflare cache. |
| **/api routes return 404/download files** | Ensure `api/` folder exists and contains `index.php`; `.htaccess` must route `/api/` requests. Check file permissions (644/755). |
| **phpMyAdmin import timeout** | Use `_nodb` seed file; if still timing out, split file and import pieces. Alternatively, use SSH `mysql` CLI. |
| **MariaDB syntax errors (IF NOT EXISTS)** | Run `database/20251212_schema_upgrade_compat.sql` via phpMyAdmin. It wraps statements in stored procedures to avoid unsupported clauses. |

---

## 11. Future updates

1. Pull latest repo.
2. `npm run build`.
3. Upload new build contents.
4. Upload updated `api/` files if backend changed.
5. Run new migrations/SQL scripts (see `DB_DEPLOY.md`).
6. Re-run smoke test. Keep `SEND_EMAILS=false` until live confirmation.

Archive each deployment package (zip + date) under `/midway-deploy-*` for rollback.

---

## Proof

- **Updated file:** `DEPLOYMENT_GUIDE.md`
- **Commands run:** `sed`, `rg`, `find backend -name "*.php" -print0 | xargs -0 -n1 php -l` (for lint verification earlier)
- **Key additions:** Layout + instructions (`DEPLOYMENT_GUIDE.md:1-210`), DB import/compat info (§6), Cloudflare/SSL notes (§7), Smoke test (§9), Common issues (§10)
