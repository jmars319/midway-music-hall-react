## Developer notes

### Suggestions API - contact normalization

Summary:

- The `suggestions` table stores submitter contact/details in a JSON column named `contact`.
- The backend API now normalizes/returns flattened contact fields so the admin UI can render them consistently.

What the API accepts (POST /api/suggestions):

- Either a `contact` object inside the payload, e.g.:

```json
{
  "artist_name": "The Example Band",
  "submission_type": "artist",
  "contact": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "555-1234",
    "music_links": ["https://soundcloud.com/example"],
    "social_media": {"instagram":"@example"},
    "genre": "indie"
  },
  "message": "We'd love to play at Midway."
}
```

- Or the same data as flattened fields (the public form uses this shape):

```json
{
  "artist_name": "The Example Band",
  "submission_type": "artist",
  "contact_name": "Jane Doe",
  "contact_email": "jane@example.com",
  "contact_phone": "555-1234",
  "music_links": ["https://soundcloud.com/example"],
  "social_media": {"instagram":"@example"},
  "genre": "indie",
  "message": "We'd love to play at Midway."
}
```

What the API returns (GET /api/suggestions):

- The response items include both the raw `contact` JSON (if present) and flattened helper fields for easy rendering:

- `artist_name`, `contact_name`, `contact_email`, `contact_phone`, `music_links`, `social_media`, `genre`, `message`.

Frontend notes:

- The admin component `frontend/src/admin/SuggestionsModule.js` reads the flattened fields and falls back to the `contact` object if necessary. If a field is missing, the UI will show nothing for that entry (no placeholder email links are rendered unless an email exists).
- The public `frontend/src/components/ArtistSuggestion.js` sends the flattened fields by default; the backend will pack them into the `contact` JSON column.

Migration/backfill:

- A migration was added earlier to consolidate `name`/`notes` into `artist_name`/`message` and to ensure `start_datetime` is canonical for events. See `backend/scripts` for the migration scripts used in development.

If you want this documented elsewhere (in the admin docs or inline component comments), tell me where and I will add it.
Midway Music Hall - Developer Guide

This developer guide documents the codebase, runtime setup, important data
shapes, the seat-request approval flow, testing tips, and suggestions for
extending or hardening the system. It's written for a new developer who will
be working on the backend API, the React frontend, or the database.

Table of contents
- Architecture overview
- Local development setup
- Database schema & migrations
- API reference (summary)
- Frontend structure & important components
- Seat-request approval flow (detailed)
- Testing & debugging
- Common extensions & migration suggestions
- Maintenance & housekeeping
- FAQ

Architecture overview
---------------------
- Backend: PHP API in `backend/` (`index.php` and `lib/*`). Configurable via `backend/.env`, deployable on GoDaddy or any PHP 8+ host. Handles events, seating config/history, seat requests, suggestions, and admin auth.
- Frontend: React app in `frontend/` (Tailwind CSS). Key UI areas:
  - Public site: seating chart, event pages, suggestion form
  - Admin panel: events, seating layout editor, seat requests review
- Database: MySQL with schema in `database/schema.sql`.

Local development setup
-----------------------
Prerequisites
- PHP 8.1+ with GD + mysqli extensions
- Node.js (LTS, e.g. 18+) for the React frontend
- MySQL server (local or Docker)

Backend
1. Create a `.env` file in `backend/` containing:

   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=yourpassword
   DB_NAME=midway_music_hall

2. From the repository root:

```bash
php -S localhost:8080 -t backend
```

This serves the API at http://localhost:8080/ with routing handled by `backend/index.php`.

Frontend
1. From the repository root:

```bash
cd frontend
npm install
npm start
# Open http://localhost:3000
```

Database schema & migrations
---------------------------
The database schema is in `database/schema.sql`. Basic tables include:
- `seating` - stores rows/groupings, `selected_seats` is a JSON column.
- `seat_requests` - requests with `selected_seats` JSON, customer contact,
  status (pending/approved/denied) and timestamps.
- `layout_history` - snapshots of admin layout edits (JSON), with pruning.

Quick local setup (MySQL):

```sql
CREATE DATABASE midway_music_hall CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE midway_music_hall;
SOURCE path/to/database/schema.sql;
```

## Migrations

We provide a small set of PHP helper scripts in `backend/scripts` to manage schema transitions and sanity checks.

- Event backfill + admin setup: `scripts/migrate_events.php`
  - Usage (dry run): `php backend/scripts/migrate_events.php`
  - Apply changes: `php backend/scripts/migrate_events.php --force`
  - Creates timestamped backups of affected tables before destructive changes.
- Image audit: `scripts/check_image_variants.php`
  - Usage: `php backend/scripts/check_image_variants.php`
  - Confirms every uploaded media item has the expected responsive variants.

Always review script output before running with `--force`. Snapshot your DB before destructive migrations, especially in production.
```

If you prefer Docker you can run a MySQL container and point `.env` at it.

API reference (summary)
-----------------------
This is a short summary of the most-used endpoints. Prefer reading
`backend/index.php` for the canonical implementation and comments.

- GET /api/health
  - Returns { success: true, status: 'ok' }

- Auth (development demo + DB check)
  - POST /api/login
  - Payload: { email, password }

- Events
  - GET /api/events
  - GET /api/events/:id
  - POST /api/events
  - PUT /api/events/:id
  - DELETE /api/events/:id

- Seating
  - GET /api/seating - returns rows with `selected_seats` field
  - POST /api/seating - create/update a seating row
  - PATCH /api/seating/:id - partial update (position, rotation, selected_seats)
  - DELETE /api/seating/:id

- Seat requests
  - GET /api/seat-requests - optional filters: event_id, status
  - POST /api/seat-requests - submit a new request (customer-facing)
    * Payload: { event_id, customer_name, contact: { email, phone }, selected_seats: ['Section-Row-1', ...], special_requests }
  - POST /api/seat-requests/:id/approve - admin approve (transactional)
  - POST /api/seat-requests/:id/deny - admin deny

- Layout history
  - POST /api/layout-history - store snapshot
  - GET /api/layout-history - list recent
  - GET /api/layout-history/:id - fetch a snapshot
  - POST /api/layout-history/prune - manual pruning

Frontend structure & important components
----------------------------------------
- `frontend/src/App.js` - main routes and app-level context (API base constant)
- `frontend/src/components/SeatingChart.js` - main visual surface for seat selection
  - Important functions: `toggleSeat`, `handleSubmit` (creates seat_request)
  - Shows pending seats (requests with status 'pending') and reserved seats
- `frontend/src/components/Table6.js` - visual layout for 6-seat tables
  - Accepts props: `row`, `selectedSeats`, `pendingSeats`, `onToggleSeat`
- `frontend/src/admin/RequestsModule.js` - admin review UI; handles approve/deny
  - Shows conflict modal on 409 from the approve endpoint

Seat-request approval flow (detailed)
-----------------------------------
This flow is important to understand when changing seating logic or the
data model.

1) Customer submits a request via POST /api/seat-requests with a list of
   seat ids (strings like "Main-A-3"). The API stores the request with
   status `pending`.

2) Admin invokes approve (POST /api/seat-requests/:id/approve). The server
   does the following inside a DB transaction:
   - Loads the `seat_requests` row and parses `selected_seats` as JSON.
   - Iterates each seat id. To find the seating row it splits by `-`:
       section = parts.join('-'); row_label = parts.pop(); seat_number = parts.pop();
     (Note: this assumes section and row don't contain ambiguous hyphens.)
   - Reads the corresponding `seating` row's `selected_seats` JSON and
     checks for any overlap/conflicts.
   - If any seat is already present, it aborts, rolls back and returns 409
     with an array of conflicting seat ids. The UI shows these to the admin.
   - If no conflicts, merges each seat id into the `seating.selected_seats`
     JSON for the appropriate seating row and updates the request status to
     `approved`, then commits the transaction.

Important constraints and suggestions
- Seat id string format is convenient but brittle. Consider migrating to a
  normalized model such as { seating_row_id, seat_index } to simplify joins.
- For higher concurrency or strict locking semantics consider using
  `SELECT ... FOR UPDATE` or an explicit `seat_holds` table to create
  temporary reservations while a user completes checkout.

Testing & debugging
-------------------
- Use temporary files for complex JSON payloads instead of shell quoting. For
  example:

```bash
cat > /tmp/payload.json <<EOF
{ "event_id": 1, "customer_name": "Alice", "contact": { "email": "a@b.com" }, "selected_seats": ["Main-A-1","Main-A-2"] }
EOF
curl -X POST -H "Content-Type: application/json" --data-binary @/tmp/payload.json http://localhost:8080/api/seat-requests
```

- To simulate conflicts, insert a `selected_seats` value into the `seating`
  table before approving a request and attempt to approve via the admin UI.

- If you change the seat id format, update parsing logic on both frontend
  and backend. Search for `.split('-')` to find places that depend on it.

Common extensions & migration suggestions
----------------------------------------
- Temporary holds: Add `seat_holds` with expiry and create endpoints to
  create/release holds. Update the frontend to reflect holds with a timer.
- Normalize seat identifiers: instead of string ids, store `seating_row_id`
  and `seat_index` (or add a lookup table). This reduces parsing fragility.
- Bulk/queue-based processing: if requests pile up, consider an approval
  worker queue that can perform conflict-resolution and retries.

Maintenance & housekeeping
-------------------------
- Git housekeeping: after history rewriting you may see warnings about
  unreachable loose objects. Running `git prune` and `git gc` locally will
  reclaim space (do this only after ensuring your necessary refs are pushed).

- Backup: keep a `backup-before-rewrite` branch before any destructive git
  history edits.

FAQ
---
Q: Why are pending seats shown in the public UI?
A: To reduce accidental double-selection and inform customers that seats
   are currently requested and awaiting admin approval.

Q: How do I add a new seat-type (e.g., `table-8`)?
A: Add new rendering support in `Table6` (or a new Table8 component), update
   `seat_type` handling in `SeatingChart` and ensure the DB `seating.total_seats`
   reflects the new count. Update admin editor if needed.

Q: Who can approve seats?
A: Currently approval is a simple POST endpoint; there's a demo auth flow in
   `backend/index.php`. For production, add proper auth/roles and protect the
   admin endpoints.

Contact
-------
If anything here is unclear or you want the guide extended with code examples
or diagrams, tell me which sections to expand next.
