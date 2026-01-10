# Midway Music Hall Developer Guide

For a full feature inventory and rationale, see `docs/SYSTEM_OVERVIEW.md`. For legacy Copilot guidance consolidated into a current summary, see `docs/COPILOT_INSTRUCTIONS_SUMMARY.md`.

## Overview
- React SPA in `frontend/` (public site + admin).
- PHP API in `backend/` (single entry: `backend/index.php`).
- MySQL schema + seed files in `database/`.

## Local development

### Backend
1. Copy `backend/.env.example` to `backend/.env` and set DB credentials.
2. Run the PHP server:
   ```bash
   php -S localhost:8080 -t backend
   ```
3. Health check: `http://localhost:8080/api/health`.

### Frontend
```bash
cd frontend
npm install
npm start
```
Open `http://localhost:3000`.

## API quick reference
Canonical behavior lives in `backend/index.php`.

- Auth: `POST /api/login`, `GET /api/session`, `POST /api/session/refresh`, `POST /api/logout`
- Events: `GET /api/events`, `GET /api/events/:id`, `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id`
- Public events: `GET /api/public/events?timeframe=upcoming`
- Seating: `GET /api/seating`, `GET /api/seating/event/:eventId`, `POST /api/seat-requests`
- Media: `GET /api/media`, `POST /api/media`, `PUT /api/media/:id`, `DELETE /api/media/:id`
- Settings: `GET /api/settings`, `PUT /api/settings`

## Frontend structure
- `frontend/src/components/` public components
- `frontend/src/admin/` admin modules
- `frontend/src/pages/` route pages
- `frontend/src/utils/` shared utilities (seat availability, event formatting)

## Seating system and layouts
- Layout templates live in `seating_layouts`; events store `layout_id` and `layout_version_id`.
- When a layout is assigned, the backend snapshots it into `seating_layout_versions` to keep reservations stable if the template changes later.
- Admins can refresh a layout version via **Apply latest layout template** (`POST /api/events/:id/refresh-layout`).
- Seat requests are stored per event instance (not the series master). Recurring cards group events for display, but reservations remain tied to the specific occurrence.
- Requests flow: public modal -> `POST /api/seat-requests` -> admin approve/deny; conflicts return 409 with seat IDs.

## Suggestions API contact normalization
- `suggestions.contact` stores JSON, but the API accepts and returns flattened fields:
  `contact_name`, `contact_email`, `contact_phone`, `music_links`, `social_media`, `genre`.
- The admin UI prefers flattened fields and falls back to the raw `contact` object.

## Admin authentication and sessions
- Cookie-backed session (`ADMIN_SESSION_COOKIE`, default `mmh_admin`).
- Two timers:
  - hard expiration (`ADMIN_SESSION_LIFETIME`, default 7 days)
  - idle timeout (`ADMIN_SESSION_IDLE_TIMEOUT`, default 4 hours)
- Admin UI pings `POST /api/session/refresh` on activity; `GET /api/session` rehydrates.

## Event lifecycle and time filters
- Event end time resolution:
  1) `end_datetime` if present
  2) otherwise `start_datetime` + 4 hours
- API filters use `timeframe=upcoming|past` based on the resolved end time.
- Timezone note: MySQL timezone tables are not available on GoDaddy; filters use `NOW()` instead of `CONVERT_TZ` to avoid NULL comparisons. If the host timezone changes, results can drift. Preferred long-term fix is storing UTC and filtering with `UTC_TIMESTAMP()`.

## Data model highlights
- `events`, `event_categories`, `event_series_meta`, `event_recurrence_rules`, `event_recurrence_exceptions`
- `seating_layouts`, `seating_layout_versions`, `seating`, `seat_requests`, `event_seating_snapshots`
- `business_settings` (CMS text + links), `media` (uploads + variants)
- `admins` (admin auth)

## Migrations and scripts
- Schema updates are the canonical `.sql` files in `database/`.
- Helper scripts:
  - `backend/scripts/migrate_events.php` imports authoritative events and recurring series.
  - `backend/scripts/check_image_variants.php` audits responsive image variants.

If you need deeper details on a module or endpoint, use `backend/index.php` as the source of truth.
