# Midway Music Hall Deployment Guide (GoDaddy + Cloudflare)

PageSpeed posture is documented in `docs/PAGESPEED_TRADEOFFS.md`.

The production layout is a React build at the site root with the PHP API mounted at `/api`.

## Target layout
```
public_html/
└── midwaymusichall.net/
    ├── index.html, asset-manifest.json, robots.txt, sitemap.xml, favicon*, manifest.json
    ├── static/                     (frontend build assets)
    ├── api/                        (copy of repo backend/)
    │   ├── index.php, bootstrap.php, lib/, uploads/, vendor/
    │   └── .env                    (production secrets)
    ├── uploads/                    (rewritten to api/uploads)
    └── .htaccess                   (repo root version)
```

Rules:
1. Frontend build output lives in `public_html/midwaymusichall.net/`.
2. Backend lives in `public_html/midwaymusichall.net/api/`.
3. `api/uploads/` must be writable.
4. Only the repo root `.htaccess` is used.

## Pre-deploy checklist (local)
- `cd frontend && npm install && npm run lint && npm run build`
- `find backend -name "*.php" -print0 | xargs -0 -n1 php -l`
- Confirm the repo root `.htaccess` is ready.
- Confirm `backend/.env.production.example` matches the keys you plan to set.

Optional packaging:
```bash
bash scripts/make-deploy-zips.sh
bash scripts/check-deploy-zips.sh
```

## Upload steps (cPanel)
1. Upload and extract the contents of `frontend/build/` into `public_html/midwaymusichall.net/`.
2. Upload the repo root `.htaccess` into the same folder.
3. Upload the repo `backend/` folder and rename it to `api/`.
4. Set permissions: directories 755, files 644, and `api/uploads/` to 775.

## Production environment variables
File: `public_html/midwaymusichall.net/api/.env`

```
APP_ENV=production
APP_KEY=generate_a_secret_key
APP_URL=https://midwaymusichall.net

DB_HOST=127.0.0.1
DB_NAME=midway_live
DB_USER=midway_user
DB_PASS=strong-password

SENDGRID_API_KEY=SG.xxxxxx
SEND_EMAILS=false
STAFF_EMAIL_TO=midwayeventcenter@gmail.com
ALERTS_EMAIL_TO=support@jamarq.digital

CORS_ALLOW_ORIGIN=https://midwaymusichall.net
ADMIN_SESSION_COOKIE_SECURE=true
```

## Database setup (phpMyAdmin)
1. Create DB + user in cPanel and grant All Privileges.
2. Import `database/20250320_full_seed_nodb.sql`.
3. Run canonical migrations in this order:
   1. `database/20250326_payment_settings.sql`
   2. `database/20251212_schema_upgrade.sql`

Verification queries:
```sql
SELECT COUNT(*) FROM events;
SELECT COUNT(*) FROM event_categories;
SELECT COUNT(*) FROM admins;
SELECT slug, COUNT(*) FROM events GROUP BY slug HAVING COUNT(*) > 1;
```

## Cloudflare settings
- SSL: Full or Full (Strict). Never Flexible.
- Enable: Always Use HTTPS, Automatic HTTPS Rewrites, Brotli, Auto Minify.
- Disable: Rocket Loader.
- Purge cache after deploy.
- Disable Cloudflare Email Obfuscation to avoid injected scripts.

## Post-deploy smoke test
Keep `SEND_EMAILS=false` until all checks pass.

1. Public site: `/`, `/thegatheringplace`, `/lessons`, `/recurring`, `/archive`.
2. Recurring cards render and do not show seat-request buttons.
3. Seating modal works for a seating-enabled event (submit a test request).
4. `/api/health` responds without errors.
5. Admin login works; Events, Seat Requests, Media, and Settings load.
6. Update Site Content or a category, refresh public site, then revert.
7. Upload and delete a test image in Media Manager.
8. `/robots.txt`, `/sitemap.xml`, `/manifest.json` load over HTTPS.

## Regression checklist (when time allows)
- Verify event publish/unpublish/archiving on admin list and public site.
- Verify seat request lifecycle (pending -> approved/denied) and conflict handling.
- Verify recurrence exceptions (skip date) remove instances from public.
- Verify time-based filtering hides past events.

## Data refresh (if reseeding events)
- Update `frontend/src/data/events.json`.
- Run `php backend/scripts/migrate_events.php`.
- Use `--force` only when you intend to overwrite existing production data.

## Final verification run order
```bash
cd frontend && npm run lint
cd frontend && npm run build
bash ./scripts/dev-start.sh
bash ./scripts/dev-verify-admin-api.sh
bash ./scripts/dev-verify-payment-settings.sh
bash ./scripts/dev-verify-seating-guardrails.sh
bash ./scripts/dev-verify-recurring-events-api.sh
bash ./scripts/dev-verify-event-images.sh
bash ./scripts/dev-verify-clearable-fields.sh
bash ./scripts/dev-stop.sh
```
