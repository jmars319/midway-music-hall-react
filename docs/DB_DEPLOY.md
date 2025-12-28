# Midway Music Hall – Database Deployment Guide (GoDaddy / phpMyAdmin)

Use this guide when preparing or refreshing the production database on GoDaddy. All commands are safe to run multiple times. Never send real emails during these steps—leave `SEND_EMAILS=false` in `.env` until post-deploy tests.

---

## 1. Create the database and user (cPanel)

1. Log into GoDaddy → **cPanel Admin** → **MySQL® Databases**.
2. Under **Create New Database**, enter the desired name (example: `midway_live`) → **Create Database**.
3. Under **MySQL Users**, create a user (example: `midway_admin`) with a strong password.
4. Under **Add User To Database**, pair the new user with the new database → grant **All Privileges**.
5. Record the database name, username, and password for `api/.env`.

---

## 2. Initial import (phpMyAdmin)

1. Launch **phpMyAdmin** from cPanel.
2. Select the database you just created in the left sidebar.
3. Click **Import**.
4. Choose `database/20250320_full_seed_nodb.sql`. This file contains schema + seed data but **no `CREATE DATABASE` / `USE` statements**, making it safe for phpMyAdmin.
5. Leave the default format (SQL) and click **Go**.
6. Wait for the success message. If any warning mentions unsupported clauses, re-run the canonical scripts listed below.

> **CLI alternative:** If you have shell access and want the script to create the DB automatically, run `mysql -uUSER -p < database/20250320_full_seed.sql`. This version includes `CREATE DATABASE` and `USE` statements; do **not** run it inside phpMyAdmin.

---

## 3. Canonical migrations (run in order)

- Canonical migrations are the plain `.sql` files under `database/`.
- Scripts ending with `_deprecated.sql` are archival only—never execute them.
- If phpMyAdmin reports an error or drops the connection, simply re-run the canonical file; each one is idempotent and guarded by helper procedures.

**Required order (current release)**
1. `database/20250326_payment_settings.sql`
2. `database/20251212_schema_upgrade.sql`

Run them immediately after the `_nodb` seed import to ensure all tables/columns exist.

---

## 4. Admin authentication table

- The PHP backend authenticates against the **`admins`** table. Login (`POST /api/login`), change-password (`POST /api/admin/change-password`), and session helpers in `backend/index.php` call `ensure_admins_table_exists()` and query `admins` exclusively.
- The older **`admin_users`** table remains in the seed only for archival parity. No PHP route reads it today, so treat it as legacy data unless the team decides to migrate or delete it later.

---

## 5. Post-Import Verification (Required)

Run each query in phpMyAdmin → SQL tab and compare the results with the expectations below.

1. **Confirm canonical admin row and email**

```sql
SELECT id, username, email
FROM admins
ORDER BY id;
```

Expected output: at least one row with `username = 'admin'` and `email = 'admin@midwaymusichall.net'`. If the email differs, re-import or update it manually before handing access to staff.

2. **Legacy admin_users table exists (for completeness)**

```sql
SHOW TABLES LIKE 'admin_users';
```

Expected output: the table name `admin_users`. No further action is required; it is not used by the application but confirms the seed ran end-to-end.

3. **Event categories list**

```sql
SELECT id, slug, name, is_active, is_system, seat_request_email_to
FROM event_categories
ORDER BY id;
```

Expected output: four seeded system categories (`normal`, `recurring`, `beach-bands`, `lessons`) with `is_active = 1` and `is_system = 1`.

4. **Events are linked to categories**

```sql
SELECT c.slug AS category_slug, COUNT(*) AS total_events
FROM event_categories c
LEFT JOIN events e ON e.category_id = c.id
GROUP BY c.slug
ORDER BY total_events DESC;
```

Expected output: counts greater than zero for each slug, confirming the backfill worked. Large zero counts indicate the import was incomplete.

---

## 6. Hook the application to the database

1. Edit `public_html/midwaymusichall.net/api/.env`.
2. Update the following keys with the database you created:
   ```
   DB_HOST=localhost
   DB_DATABASE=midway_live
   DB_USERNAME=midway_admin
   DB_PASSWORD=********
   ```
3. Confirm `APP_ENV=production` and `SEND_EMAILS=false`.
4. Save changes and ensure `.env` permissions restrict public reads (640 or similar).

---

## 7. Post-import checklist

- [ ] Import completed with no fatal errors.
- [ ] Canonical scripts (`20250326_payment_settings.sql`, `20251212_schema_upgrade.sql`) ran without fatal errors; rerun if phpMyAdmin complained about `IF NOT EXISTS`.
- [ ] Verification queries returned expected data counts.
- [ ] `.env` updated with DB credentials.
- [ ] Admin login works locally against the new database.
- [ ] `[email:skip]` logs appear when seat-request actions run (confirms email safety).

Only move on to DNS cutover after `DEPLOY_SMOKE_TEST.md` passes. Real email delivery can be tested later by flipping `SEND_EMAILS=true` **only** in production once staff is ready.

---

## Final Verification Run Order
After applying schema upgrades in phpMyAdmin, run:
```bash
cd frontend && npm run lint
cd frontend && npm run build
bash ./scripts/dev-start.sh
bash ./scripts/dev-verify-admin-api.sh
bash ./scripts/dev-verify-payment-settings.sh
bash ./scripts/dev-verify-seating-guardrails.sh
bash ./scripts/dev-verify-recurring-events-api.sh  # if present
bash ./scripts/dev-verify-event-images.sh
bash ./scripts/dev-verify-clearable-fields.sh
bash ./scripts/dev-stop.sh
```
Reminder: schema upgrade → verification scripts → deploy backend → deploy frontend.
