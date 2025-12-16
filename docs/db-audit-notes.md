# DB Audit Notes - Midway Music Hall

_Last updated: 2025-12-12_

## A. Admin Panel Inventory
Each module lives under `frontend/src/admin/` and calls the PHP API via `API_BASE`.

### DashboardModule
- **Purpose:** Snapshot of venue health (counts + quick links).
- **Fields Shown:** Upcoming events count, pending seat requests, pending suggestions, events this month.
- **API Routes:** `GET /api/dashboard-stats` (expects `{ success, stats: { upcoming_events, pending_requests, pending_suggestions, events_this_month } }`).
- **Notes:** UI only reads data; no mutations.

### EventsModule
- **Purpose:** CRUD for public events.
- **Editable Fields:** `artist_name`, `genre`, `description`, `event_date`, `event_time`, `ticket_price`, `door_price`, `age_restriction`, `venue_section`, `layout_id`, `image_url` (or uploaded file).
- **API Routes:**
  - `GET /api/events` (expects array with `id`, `artist_name`, `genre`, `description`, `image_url`, `ticket_price`, `door_price`, `age_restriction`, `venue_section`, `start_datetime`, `end_datetime`, `layout_id`, `status`, legacy `event_date`/`event_time`).
  - `POST /api/events` + `PUT /api/events/:id` (payload mirrors editable fields plus `start_datetime/end_datetime`).
  - `DELETE /api/events/:id`.
  - `GET /api/seating-layouts` populates the layout dropdown (`id`, `name`, `is_default`).
  - `POST /api/upload-image` for hero/event artwork (multipart, returns `{ success, url, filename }`).
- **Notes:** Currently no notion of draft/published or recurring rules in UI; expects immediate persistence.

### LayoutsModule
- **Purpose:** Template builder for seating charts, including stage metadata.
- **Editable Fields:** Layout metadata (`name`, `description`, `is_default`), `layout_data` array (per-row objects: `section_name`, `row_label`, `seat_type`, `table_shape`, `total_seats`, `pos_x`, `pos_y`, `rotation`, `id`), plus `stage_position` (`{ x, y }`) and `stage_size` (`{ width, height }`).
- **API Routes:**
  - `GET /api/seating-layouts`, `POST /api/seating-layouts`, `PUT /api/seating-layouts/:id`, `DELETE /api/seating-layouts/:id`.
  - `POST /api/layout-history` (saves snapshots, expects `{ snapshot }`).
  - `GET /api/layout-history[?limit=]` and `GET /api/layout-history/:id` to restore.
  - `GET /api/stage-settings` / `PUT /api/stage-settings` for global stage locks + coordinates.
  - `PATCH /api/seating/:id` used when editing seat positions inline.
- **Notes:** Requires `layout_data` stored as JSON. Default layout flagged via `is_default`.

### SeatingModule
- **Purpose:** Legacy row-based seating list + drag editor for on-the-fly adjustments.
- **Fields:** Table rows display `section/section_name`, `row_label`, `seat_number`, `total_seats`, `seat_type`, `table_shape`, `is_active`, `pos_x`, `pos_y`, `rotation`, `status`. Form adds/edits the same, with `event_id` optional and stage-lock toggles.
- **API Routes:**
  - `GET /api/seating` (returns shapshot of seating rows, expects alias `section_name` in response).
  - `POST /api/seating` (insert or update depending on payload `id`).
  - `PATCH /api/seating/:id` (partial update) and `DELETE /api/seating/:id`.
  - Shares `GET/PUT /api/stage-settings` and layout-history endpoints for history, as above.
- **Notes:** Editor persists `pos_x/pos_y/rotation` to `seating` table and stage settings to `stage_settings`.

### RequestsModule (advanced) & SeatRequestsModule (table-only view)
- **Purpose:** Review customer reservations/holds per event.
- **Fields:** `customer_name`, `event_title`, `event_date`, `event_time`, `selected_seats` list, `customer_email`, `customer_phone`, `status` (`pending|approved|denied`).
- **API Routes:**
  - `GET /api/seat-requests[?event_id=&status=]` returns `{ requests }` with normalized contacts and event join fields.
  - `POST /api/seat-requests/:id/approve` + `/deny` mutate status; `/approve` may return `409` with `{ conflicts: [seatIds] }`.
  - `PUT /api/seat-requests/:id` for manual status edits.
  - `DELETE /api/seat-requests/:id` removes a request.
- **Notes:** Approval endpoint merges seat IDs into `seating.selected_seats`. Future hold/finalized states need schema support.

### SuggestionsModule
- **Purpose:** Intake artist/band suggestions.
- **Fields:** `artist_name`, `genre`, `submission_type` (`self` vs `fan`), contact info (`contact_name`, `contact_email`, `contact_phone`, `music_links`, `social_media`), `message/notes`, `status` dropdown.
- **API Routes:**
  - `GET /api/suggestions` (expects JSON-broken-out contact fields; backend currently normalizes raw `contact` JSON).
  - `PUT /api/suggestions/:id` updates `status`/`notes`.
  - `DELETE /api/suggestions/:id` removes.
- **Notes:** Public suggestion form hits `POST /api/suggestions` (not surfaced here but used elsewhere).

### MediaManager
- **Purpose:** Upload + categorize venue imagery.
- **Fields:** Upload form collects `file`, `category` (`logo|hero|gallery|other`). Detail cards allow editing `category`, `alt_text`, `caption`, copying URLs.
- **API Routes:**
  - `GET /api/media[?category=]` returns metadata rows.
  - `POST /api/media` (multipart with `file`, `category`, optional `alt_text`, `caption`).
  - `PUT /api/media/:id` updates metadata.
  - `DELETE /api/media/:id` removes row and file from disk.
- **Notes:** Frontend expects `file_url` for rendering, `filename` for operations.

### SettingsModule
- **Purpose:** CMS-like controls for hero/about copy and venue contact info.
- **Fields:** `business_name`, `business_phone`, `business_email`, `business_address`, `hero_title`, `hero_subtitle`, `about_title`, `about_description`, social URLs (`facebook_url`, `instagram_url`, `twitter_url`), hero image selection (stores JSON array in `hero_images`), plus references to `site_logo`/`default_event_image` stored in `business_settings`.
- **API Routes:**
  - `GET /api/settings` returns `{ settings: { key: value } }` from `business_settings` table.
  - `PUT /api/settings` upserts a key/value map.
  - Uses `GET /api/media?category=logo|hero` to populate media pickers.
- **Notes:** Any additional CMS text must be persisted via `business_settings`.

## B. Current Database Schema Inventory
Sources: `database/schema.sql` plus migrations, plus fields referenced in `backend/index.php`.

| Table | Key Columns / Notes | Usage |
| --- | --- | --- |
| `admins` | `id`, `username` (unique), `password_hash`, `email`. | Auth for admin login via `/api/login` (with demo fallback). |
| `events` | Legacy schema in `schema.sql` only has `title`, `description`, `start_datetime`, `end_datetime`, `venue_section`, `created_at`. The live backend expects extended columns: `artist_name`, `genre`, `description`, `image_url`, `ticket_price`, `door_price`, `age_restriction`, `venue_section`, `start_datetime`, `end_datetime`, `layout_id`, `status`, plus older `event_date/event_time`. | Primary event listing for public/admin; currently populated with placeholders that must be replaced. |
| `seating` | `id`, `event_id`, `layout_id`, `section`, `row_label`, `seat_number`, `total_seats`, `seat_type`, `table_shape`, `is_active`, `selected_seats` (JSON), `pos_x`, `pos_y`, `rotation`, `status`. | Drives seat map editing + linking to layouts. |
| `seating_layouts` | `id`, `name`, `description`, `is_default`, `layout_data` (JSON), `stage_position` (JSON), `stage_size` (JSON), timestamps. | Template library for seat charts; events reference `layout_id`. |
| `stage_settings` | `id`, `key_name`, `value`. | Stores `stage_pos_x`, `stage_pos_y`, `stage_size`, `stage_lock`, etc. |
| `seat_requests` | Known columns from backend: `event_id`, `customer_name`, `customer_email`, `customer_phone`, `contact` (JSON), `selected_seats` (JSON), `total_seats`, `special_requests`, `status` (`pending/approved/denied`), timestamps. | Reservation queue + admin workflow. |
| `layout_history` | `id`, `snapshot` (JSON), `created_at`. | Server-side undo/redo snapshots for seating editor. |
| `suggestions` | `id`, `name`, `contact` (JSON), `notes`, `submission_type`, `status`, timestamps. | Artist suggestion inbox. |
| `business_settings` | `id`, `setting_key` (unique), `setting_value`, `updated_at`. | CMS-style settings (hero copy, social links, logos, etc.). |
| `media` | `id`, `filename`, `original_name`, `file_path`, `file_url`, `file_size`, `mime_type`, `category`, `alt_text`, `caption`, `uploaded_by`, timestamps, indexes on `category` and `created_at`. | Media library for logos/hero/gallery assets. |

## C. Table Classification
- **Preserve (authoritative content / config):** `admins`, `business_settings`, `media`, `suggestions`, `seat_requests`, `stage_settings`, `layout_history`, `seating_layouts` (structure + curated templates), `seating` (layout geometry tied to templates), `layout_history` (for audit), plus any future audit/log tables.
- **Replace (placeholder/test data):** `events` rows (currently auto-generated / stale). Dependent placeholder data such as old seat assignments tied to fake events should be refreshed alongside the new recurrence-aware schema; capture backups before truncating. Seating rows that solely exist for placeholder events should be regenerated per canonical layouts. 
- **Unknown/Unused (report only, leave intact):** None identified beyond the schema staples above; if other tables exist in the live DB they were not referenced in code. Treat any unreferenced tables as out-of-scope until confirmed.

## D. Reference Data Sources
- **Single-page authoritative events:** `frontend/src/data/events.json` (dated + recurring beach bands data). Additional contextual content: `frontend/src/data/contacts.json` and `frontend/src/data/policies.json` (venue info displayed publicly).
- **Existing backend contract:** `/backend/index.php` (PHP API) defines the canonical endpoints consumed by the React app.

## E. Immediate Gaps / Observations
1. `events` schema mismatch - DB DDL lacks the fields the UI/API rely on (`artist_name`, `ticket_price`, `status`, layout reference, etc.).
2. No dedicated tables for recurrence rules, overrides, or reservation holds/finalization yet; will need additive migrations.
3. Placeholder event data differs from the authoritative single-page dataset; migration must transform JSON data (including recurring patterns) into relational tables.
4. Seat requests currently only have `pending/approved/denied` statuses; new hold/finalized workflow will require schema + API adjustments.
5. Media pipeline expects image validation/resizing/WebP; DB already stores necessary metadata (`mime_type`, `file_size`, `category`), but PHP backend must enforce optimization.

This document will evolve as schema updates and migrations are implemented.
