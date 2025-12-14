# Midway Music Hall – GoDaddy/Cloudflare Deployment Guide

This guide walks through publishing the existing Midway Music Hall build to GoDaddy cPanel (Apache/PHP) that sits behind Cloudflare. Follow the steps in order. All wording assumes the production docroot is `public_html/midwaymusichall.net/` and the PHP backend is served from `/api`.

---

## 1. Production Folder Layout (final)

All files belong inside `public_html/midwaymusichall.net/`:

```
public_html/
└── midwaymusichall.net/
    ├── index.html, asset-manifest.json, robots.txt, sitemap.xml, manifest.json
    ├── static/… (React build assets)
    ├── api/                    ← copy of repo php-backend/
    │   ├── index.php, bootstrap.php, lib/, uploads/
    │   └── .env                ← created from .env.production.example
    ├── uploads/                ← virtual path, served via rewrite to api/uploads/
    └── .htaccess               ← repo root version (already includes API + SPA rules)
```

**Key rules**
1. Always upload the React build output directly into `public_html/midwaymusichall.net/`.
2. Rename/copy `php-backend/` to `api/` within the same folder.
3. `api/uploads/` must be writable (775 or via cPanel “Change Permissions”).
4. The only `.htaccess` lives at the docroot. Do **not** deploy legacy copies.

---

## 2. Before you start

| Task | Command / location |
|------|-------------------|
| Install deps | `npm install` (frontend) |
| Lint + build | `npm run lint && npm run build` (frontend) |
| PHP syntax check | `php -l php-backend/index.php php-backend/bootstrap.php php-backend/lib/Emailer.php` |
| Confirm `.htaccess` | Root `.htaccess` already configured with HTTPS, `/api`, `/uploads`, and SPA fallback |
| Confirm env template | `php-backend/.env.production.example` lists required keys (keep `SEND_EMAILS=false` until live testing) |

---

## 3. Create the production build locally

```bash
cd frontend
npm run build
# build output lives in frontend/build/
```

Zip the contents of `frontend/build/` (not the folder itself) or upload the folder with your preferred SFTP/File Manager tool.

---

## 4. Upload files to GoDaddy

1. Log in to GoDaddy → Hosting → **cPanel Admin** → **File Manager**.
2. Navigate to `public_html/` and create/enter the folder `midwaymusichall.net/`.
3. Upload the contents of `frontend/build/` into `public_html/midwaymusichall.net/`. Overwrite existing files on updates.
4. Upload the repository root `.htaccess` into the same folder. (Show hidden files to confirm it exists.)
5. Upload the entire `php-backend/` folder and rename it to `api/` inside `public_html/midwaymusichall.net/`.
6. In File Manager, set permissions:
   - Directories: 755 (check “recurse into subdirectories”).
   - Files: 644.
   - `api/uploads/`: ensure write access for PHP (775 or “Writable” in File Manager).

---

## 5. Configure production environment variables

1. Inside `public_html/midwaymusichall.net/api/`, copy `php-backend/.env.production.example` to `.env`.
2. Populate with production secrets (database host, DB name, username, password, APP_KEY, SendGrid keys if/when ready).
3. Set:
   - `APP_ENV=production`
   - `SEND_EMAILS=false` until you are ready to test live emails.
   - `CORS_ALLOW_ORIGIN=https://midwaymusichall.net`
   - `ADMIN_SESSION_COOKIE_SECURE=true`
4. Save the file and ensure it is **not** world-readable (permission 640 or similar). `.htaccess` already blocks direct access.

---

## 6. Database creation and import (phpMyAdmin)

1. In cPanel, open **MySQL® Databases**:
   - Create a database (example `midway_live`).
   - Create a database user (example `midway_user`) and assign it a strong password.
   - Add the user to the database with **All Privileges**.
2. Open **phpMyAdmin**, select the new database, and use **Import**.
3. Choose `database/20250320_full_seed_nodb.sql` (no `CREATE DATABASE` statements) and run the import.
4. If the host lacks `ADD COLUMN IF NOT EXISTS`, re-run any compat migrations listed in `DB_DEPLOY.md`.
5. Run the verification queries from `DB_DEPLOY.md` (categories, audit_log, recurrence counts).
6. Update `api/.env` with the DB name/user/password you created.

> Need to re-seed from scratch? Use `database/20250320_full_seed.sql` from the mysql CLI where `CREATE DATABASE` is allowed. phpMyAdmin users should always prefer the `_nodb` file.

---

## 7. Cloudflare + domain settings

1. **DNS** – In Cloudflare, add A records for `@` and `www` pointing to the GoDaddy server IP with proxy (orange cloud) enabled.
2. **SSL/TLS** – Set encryption mode to **Full** (or Full Strict). Disable Flexible to avoid redirect loops.
3. **Always Use HTTPS** + **Automatic HTTPS Rewrites** – Enable both under SSL/TLS → Edge Certificates.
4. **Speed** – Enable Brotli + Auto Minify (HTML/CSS/JS). Leave Rocket Loader disabled.
5. **Caching** – Keep “Standard” and “Respect existing headers”.
6. Wait for DNS changes to propagate (usually <1 hour).

---

## 8. Post-deploy verification

Run through `DEPLOY_SMOKE_TEST.md`. Highlights:

1. Visit `https://midwaymusichall.net` – check hero, Upcoming, Recurring, Beach Series, Lessons, footer contacts.
2. Visit `/thegatheringplace` – confirm cards and seating buttons follow the current rules (no RSVP for recurring).
3. Check `/api/health` (or any existing health endpoint) to ensure the backend responds without exposing stack traces.
4. Log into `/admin`:
   - Events list shows upcoming + recurring groupings.
   - Categories CRUD works.
   - Seat requests show notification inbox info.
   - Site Content edits reflect publicly after refresh.
   - Audit Log entries appear after making edits.
5. Confirm uploads work by adding/removing a sample file in Media.
6. Ensure `[email:skip]` logs appear instead of live sends (SEND_EMAILS should still be false).

If any issue appears, re-check `.env`, permissions, and that `.htaccess` matches the repo version.

---

## 9. Future updates / quick redeploy

1. Pull latest repo changes.
2. `npm run build`.
3. Upload new `frontend/build/` contents.
4. If backend changes are included, upload updated PHP files to `api/`.
5. Run any new migrations plus compat scripts.
6. Re-run smoke test and keep SEND_EMAILS disabled until ready for live notifications.

---

## Reference files

| File | Purpose |
|------|---------|
| `.htaccess` | Final rewrite rules (HTTPS, `/api`, `/uploads`, SPA fallback) |
| `php-backend/.env.production.example` | Template for production environment variables |
| `database/20250320_full_seed.sql` | Full schema + data, includes `CREATE DATABASE` (use mysql CLI) |
| `database/20250320_full_seed_nodb.sql` | Same as above without `CREATE DATABASE` statements for phpMyAdmin |
| `DB_DEPLOY.md` | Detailed DB import + verification instructions |
| `PRE_DEPLOYMENT_CHECKLIST.md` | One-page list of tasks before switching DNS |
| `DEPLOY_SMOKE_TEST.md` | Manual verification steps after deployment |

Stay within this guide, keep instructions linear, and always leave email sending disabled until production staff explicitly test notifications.
