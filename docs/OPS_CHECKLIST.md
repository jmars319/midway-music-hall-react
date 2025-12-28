# Midway Music Hall – Ops Checklist (“Lock & Ship”)

Canonical run-book for preparing and deploying the MMH stack. Keep this file alongside `DEPLOYMENT_GUIDE.md` and `PRE_DEPLOYMENT_CHECKLIST.md`.

---

## Operator Notes
- **Series masters** (Recurring category or `is_series_master=1`) can be edited without touching schedule fields; “Recurring Series Details” saves metadata only.
- **Seat reservations toggle** is non-destructive. Turning it off hides seating UI but never clears `layout_id`, `layout_version_id`, or seat_requests.
- **Layout changes** always show a confirmation modal and automatically capture a seating snapshot before the new layout is saved.
- **Seating snapshots** can now be “Previewed” (read-only) or “Restored” from the admin editor. Preview shows reserved/pending/hold lists plus diffs vs current.

---

## Pre-Deploy Verification (run locally)
```bash
cd frontend && npm run lint
cd frontend && npm run build
cd .. && bash scripts/dev-verify.sh
bash scripts/dev-verify-recurring-events-api.sh
bash scripts/dev-verify-seating-guardrails.sh
bash scripts/make-deploy-zips.sh && bash scripts/check-deploy-zips.sh
```
- Address any failures before packaging. Store the generated `deploy-backend.zip` and `deploy-frontend.zip` for handoff.

---

## Migration Policy (Locked)
- Canonical migrations are plain `.sql` files and the only scripts executed in dev or production.
- Deprecated migrations end with `_deprecated.sql`, remain for history only, and must never be executed.
- All schema updates run manually through phpMyAdmin with “Allow multiple statements” enabled.
- Apply canonical migration files exactly in the order listed below; this order is non-negotiable.

**Canonical order for this release**
1. `database/20250326_payment_settings.sql`
2. `database/20251212_schema_upgrade.sql`

Each script is idempotent—rerunning them is safe and expected if phpMyAdmin reports recoverable errors.

---

## Final Verification Run Order
Run the canonical schema upgrade in phpMyAdmin first, then execute:
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
Reminder: phpMyAdmin schema upgrade → verification scripts → deploy backend → deploy frontend.

---

## Production Migration (phpMyAdmin)
1. Import `database/20250326_payment_settings.sql`.
2. Import `database/20251212_schema_upgrade.sql`.
3. Confirm the following tables exist afterward (ignore “already exists” warnings):
   - `payment_settings`
   - `event_series_meta`
   - `event_seating_snapshots`
4. If phpMyAdmin warns about unsupported clauses, rerun the same canonical file; each helper procedure guards against duplicates.

---

## Deploy Order
1. Upload/extract `deploy-backend.zip` into `public_html/midwaymusichall.net/api/` (preserve `.env` + `uploads/`).
2. Upload/extract `deploy-frontend.zip` into `public_html/midwaymusichall.net/`.
3. Purge Cloudflare cache after both portions complete.

---

## Post-Deploy Smoke Checks
1. **Series master edit** – Admin → Events → edit a recurring series master. Update only the “Recurring Series Details” fields; save succeeds without requiring date/time.
2. **Public recurring card** – Home page Recurring grid shows Typical Schedule label + footer note from the edited series.
3. **Seating guardrail** – Admin → Events → toggle “Seat Reservations” off/on for an event; verify seating UI hides but layout/reservations remain unchanged.
4. **Layout change snapshot** – Edit event with seating, change layout → confirmation modal appears → after confirming, toast references saved snapshot.
5. **Snapshots panel** – With an event selected:
   - Snapshot list loads (Refresh works).
   - “Preview” opens read-only modal (counts + seat listings).
   - “Restore layout & seats” works on a throwaway event (expect snapshot message + conflicts list if seats differ).

Record outcomes in `DEPLOYMENT_STATUS.md`.

---

## Break Glass: Seating Snapshot Recovery
- **What’s inside a snapshot**: arrays of `reserved_seats`, `pending_seats`, and `hold_seats` plus metadata (created time, layout/version at capture).
- **Preview first**: use the new Preview button to inspect seat IDs, search for specific seats, and compare vs current reservations without changing data.
- **Restore carefully**: “Restore layout & seats” overwrites current seat_requests with the snapshot’s data and reassigns the captured layout. Use only when recovering from mistakes; normal layout changes already capture a snapshot and prompt for confirmation.
- **Safety reminder**: Layout changes are the only destructive-adjacent action. They are protected by the confirmation modal plus auto-snapshot.

---

## Command Quick Reference
```bash
# Local validation
cd frontend && npm run lint && npm run build
cd .. && bash scripts/dev-verify.sh
bash scripts/dev-verify-recurring-events-api.sh
bash scripts/dev-verify-seating-guardrails.sh
bash scripts/make-deploy-zips.sh && bash scripts/check-deploy-zips.sh

# phpMyAdmin migration
-- Run in production DB, exact order
SOURCE database/20250326_payment_settings.sql;
SOURCE database/20251212_schema_upgrade.sql;
```
