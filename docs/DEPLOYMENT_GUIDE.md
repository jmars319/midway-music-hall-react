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
5. Branded static error documents (`403.html`, `404.html`, `500.html`, `503.html`) are served from the site root.

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
Note: `scripts/make-deploy-zips.sh` runs the frontend build automatically before creating the zips.

## Upload steps (cPanel)
1. Upload and extract the contents of `frontend/build/` into `public_html/midwaymusichall.net/`.
2. Upload the repo root `.htaccess` into the same folder.
3. Upload the repo `backend/` folder and rename it to `api/`.
4. Set permissions: directories 755, files 644, and `api/uploads/` to 775.

## Production environment variables
File: `public_html/midwaymusichall.net/api/.env`

```
APP_ENV=production
APP_DEBUG=false

DB_HOST=127.0.0.1
DB_NAME=midway_live
DB_USER=midway_user
DB_PASSWORD=strong-password

SENDGRID_API_KEY=SG.xxxxxx
SEND_EMAILS=false
STAFF_EMAIL_TO=midwayeventcenter@gmail.com
ALERTS_EMAIL_TO=support@jamarq.digital

CORS_ALLOW_ORIGINS=https://midwaymusichall.net
ADMIN_SESSION_COOKIE_SECURE=true
PAYPAL_ENVIRONMENT=production
PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_CLIENT_SECRET=your-paypal-client-secret
PAYPAL_CHECKOUT_RETURN_URL=https://midwaymusichall.net/payment/return
PAYPAL_CHECKOUT_CANCEL_URL=https://midwaymusichall.net/payment/cancelled
PAYPAL_WEBHOOK_ID=your-paypal-webhook-id
PAYPAL_WEBHOOK_NOTIFICATION_URL=https://midwaymusichall.net/api/webhooks/paypal
SQUARE_ENVIRONMENT=production
SQUARE_ACCESS_TOKEN=your-square-access-token
SQUARE_LOCATION_ID=your-square-location-id
SQUARE_CHECKOUT_REDIRECT_URL=https://midwaymusichall.net/payment/return
SQUARE_WEBHOOK_SIGNATURE_KEY=your-square-webhook-signature-key
SQUARE_WEBHOOK_NOTIFICATION_URL=https://midwaymusichall.net/api/webhooks/square
```

Use `backend/.env.production.example` as the canonical key list. Older names like `DB_PASS` are not read by the backend.

Square production notes:
- `SQUARE_ACCESS_TOKEN` must be a server-side token for the same Square account and location you intend to use.
- `SQUARE_LOCATION_ID` must match the location used for checkout links.
- `SQUARE_WEBHOOK_NOTIFICATION_URL` must exactly match the public webhook URL configured in Square, including `https://` and path.
- `SQUARE_WEBHOOK_SIGNATURE_KEY` must be the signature key from that Square webhook subscription.
- `SQUARE_CHECKOUT_REDIRECT_URL` is optional but recommended if you want buyers returned to MMH after Square-hosted checkout.
- The MMH-branded public return page for this build is `/payment/return`.
- Cash App Pay is exposed through Square checkout when the Square provider is enabled for a scope and the `Allow Cash App Pay inside Square checkout` toggle is enabled in admin.

PayPal production notes:
- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are the server-side REST credentials for the live PayPal app.
- `PAYPAL_WEBHOOK_ID` must be the webhook ID from the PayPal app that points at `PAYPAL_WEBHOOK_NOTIFICATION_URL`.
- `PAYPAL_CHECKOUT_RETURN_URL` and `PAYPAL_CHECKOUT_CANCEL_URL` should return buyers to MMH-branded `/payment/*` routes.
- The PayPal provider only appears publicly when both the provider row is enabled in admin and the backend PayPal readiness checks are complete.

## Database setup (phpMyAdmin)
1. Create DB + user in cPanel and grant All Privileges.
2. Import `database/20250320_full_seed_nodb.sql`.
3. Run canonical migrations in this order:
   1. `database/20250326_payment_settings.sql`
   2. `database/20251212_schema_upgrade.sql`
   3. `database/20260414_payment_provider_matrix.sql`
   4. `database/20260409_content_compatibility_backfill.sql`

The full seed dumps now include `event_occurrences`, but you should still run the canonical migrations after any seed import so older columns, indexes, and compatibility changes stay aligned.

Content compatibility note:
- `database/20260409_content_compatibility_backfill.sql` is the safe way to preserve legacy recurring homepage card copy and legacy lessons content on older installs that relied on runtime defaults.
- It only fills missing values. It does not overwrite admin-managed lessons or recurring series metadata.
- Do not run `database/20250312_site_content_seed.sql` on production just to restore lessons content unless you explicitly want its full site-content seed values applied.

Optional legacy backfill:
- If you want every pre-existing single-day event on production to have one normalized occurrence row, run `database/20260316_event_occurrences_backfill.sql` once after `database/20251212_schema_upgrade.sql`.

Verification queries:
```sql
SELECT COUNT(*) FROM events;
SELECT COUNT(*) FROM event_categories;
SELECT COUNT(*) FROM admins;
SELECT slug, COUNT(*) FROM events GROUP BY slug HAVING COUNT(*) > 1;
SHOW COLUMNS FROM events LIKE 'pricing_config';
SELECT setting_key, JSON_VALID(setting_value) AS json_valid FROM business_settings WHERE setting_key = 'lessons_json';
SELECT COUNT(*) AS recurring_series_meta_rows FROM event_series_meta;
```

## Cloudflare settings
- SSL: Full or Full (Strict). Never Flexible.
- Enable: Always Use HTTPS, Automatic HTTPS Rewrites, Brotli, Auto Minify.
- Disable: Rocket Loader.
- Purge cache after deploy.
- Disable Cloudflare Email Obfuscation to avoid injected scripts.

## Optional maintenance mode
The production `.htaccess` supports a simple public maintenance toggle without taking admin or API routes offline.

Enable maintenance mode:
```bash
touch public_html/midwaymusichall.net/maintenance.enable
```

Disable maintenance mode:
```bash
rm -f public_html/midwaymusichall.net/maintenance.enable
```

Behavior:
- Public routes return a real HTTP `503` and show the branded `503.html` page.
- `/api`, `/login`, `/admin`, `/dashboard`, and `/payment/*` stay reachable.
- Unknown public URLs still return the branded `404.html` page once maintenance mode is off.

## Post-deploy smoke test
Keep `SEND_EMAILS=false` until all checks pass.

1. Public site: `/`, `/thegatheringplace`, `/lessons`, `/recurring`, `/archive`.
2. Recurring cards render and do not show seat-request buttons.
3. Seating modal works for a seating-enabled event (submit a test request).
4. If a special event uses tiered pricing, confirm the public schedule shows the tier summary and the seating modal shows the pricing legend/list.
5. `/api/health` responds without errors.
6. Admin login works; Events, Seat Requests, Media, and Settings load.
7. Update Site Content or a category, refresh public site, then revert.
8. Upload and delete a test image in Media Manager.
9. `/robots.txt`, `/sitemap.xml`, `/manifest.json` load over HTTPS.
10. If Square or PayPal is enabled, submit a test seat request, launch each enabled checkout, complete one payment, and confirm the request stays `Paid / pending confirmation` without auto-confirming seats.
11. Visit a bogus URL such as `/this-should-404` and confirm the branded 404 page appears.
12. Optional: create `maintenance.enable`, confirm the public site returns the branded 503 page while `/login`, `/admin`, and `/api/health` still respond, then remove the file.

## Regression checklist (when time allows)
- Verify event publish/unpublish/archiving on admin list and public site.
- Verify seat request lifecycle (pending -> approved/denied) and conflict handling.
- Verify a tiered-pricing event can be created, edited, switched back to flat pricing, and still produces correct seat-request totals.
- Verify recurrence exceptions (skip date) remove instances from public.
- Verify time-based filtering hides past events.

## Optional repair for legacy NULL event status/visibility
Behavior note: create/update paths now normalize missing/invalid `status` and `visibility` to `draft`/`private`, and admin list filtering treats legacy NULLs as those same defaults.
Run only when you explicitly want to normalize legacy rows.

```sql
UPDATE events
SET
  status = COALESCE(NULLIF(TRIM(status), ''), 'draft'),
  visibility = COALESCE(NULLIF(TRIM(visibility), ''), 'private')
WHERE status IS NULL OR TRIM(status) = '' OR visibility IS NULL OR TRIM(visibility) = '';
```

## Data refresh (if reseeding events)
- Update `frontend/src/data/events.json`.
- Run `php backend/scripts/migrate_events.php`.
- Use `--force` only when you intend to overwrite existing production data.

## Final verification run order
```bash
cd frontend && npm run lint
cd frontend && npm run build
bash ./scripts/dev-verify-all.sh
```
