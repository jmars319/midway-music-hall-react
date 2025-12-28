# Operator Checklist - Midway Music Hall Backend Refresh

## 1. Schema upgrade
1. Export the current database before making changes.
2. Migration policy (locked):
   - Canonical migrations are the plain `.sql` files listed below.
   - Files ending with `_deprecated.sql` are for history only—do **not** execute them.
   - Always enable “Allow multiple statements” in phpMyAdmin and re-run canonical scripts in order if any step fails (they are idempotent).
3. Run the canonical scripts in this exact order:
   ```bash
   mysql -u <user> -p'<password>' -h <host> midway_music_hall < database/20250326_payment_settings.sql
   mysql -u <user> -p'<password>' -h <host> midway_music_hall < database/20251212_schema_upgrade.sql
   ```
   - These scripts define helper stored procedures internally so repeat executions are safe and required when MariaDB applies partial changes.

## 2. Import authoritative events
1. Ensure `frontend/src/data/events.json` contains the latest single-page source of truth.
2. Copy or edit `backend/.env` with the production credentials.
3. Run the importer once from the repo root:
   ```bash
   php backend/scripts/migrate_events.php
   ```
   - The script backs up `events` into `events_backup_20251212`, clears placeholder events, and imports both single-date events and recurring series.
   - Re-run with `--force` only if you explicitly need to overwrite existing production data. A key in `business_settings (events_seed_version_20251212)` prevents accidental repeats.

## 3. Post-migration smoke tests
Run these via the React app + admin panel (staging first, then production):

1. **Event publishing**
   - Create a draft event in the admin; confirm it is hidden from `/api/public/events` until status changes to `published`.
   - Publish an event for each venue (MMH and TGP) and confirm `/api/public/events?venue=MMH` / `?venue=TGP` respond appropriately.

2. **Recurrence CRUD**
   - Load a recurring series via `/api/events/:id/recurrence`.
   - Update the rule (e.g., switch between weekly/monthly) and add an exception date.
   - Confirm GET endpoints reflect the change; validate the admin UI handles the response.

3. **Seat reservations**
   - Submit a seat request from the public modal. The new request should enter `hold` status and appear in admin with a 24-hour expiry (6PM cutoff rule applies).
   - Approve (finalize) a request and make sure:
     - The request moves to `finalized` with `finalized_at` set.
     - The seats show up under `reservedSeats` in `/api/seating/event/:id`.
   - Let a hold expire (or set `hold_expires_at` manually and reload) and verify it auto-cancels and releases seats.

4. **Admin editing**
   - Update an existing event’s slug, venue, ticket type, and layout selection; ensure the API responds with the updated slug and assigns a layout version.
   - Soft-delete an event and confirm it disappears from default admin/public lists, but can be restored via `include_deleted=1`.

5. **Media uploads**
   - Upload a large JPG/PNG. The response should include `width`, `height`, `optimized_path`, and `webp_path`.
   - Check the `/uploads/optimized/` and `/uploads/webp/` directories to ensure resized assets were generated.
   - Delete the media entry and confirm all variants are removed.

6. **CMS settings**
   - Update hero/about copy and social links in the admin settings page; verify `/api/settings` returns the new values and that the public site reflects them.

7. **Placeholder vs. live site parity**
   - Compare the single-page placeholder schedule against the new `/api/public/events` payload to ensure all events (including recurring beach bands) are present.

Document any discrepancies found during validation before pushing changes to production.

---

## Final Verification Run Order
Before deploying, apply the schema upgrade via phpMyAdmin, then run:
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
