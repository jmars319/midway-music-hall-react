Midway Music Hall — Developer Guide

Overview
--------
This guide explains the repository layout, core data shapes, development workflows, and how the seat request/approval system works.

Repository layout
-----------------
- backend/: Express server and API (MySQL powered)
  - server.js — main API file and DB connection
  - .env (ignored) — DB credentials and runtime configuration
- frontend/: React app (TailwindCSS). Key files under `src/` include:
  - src/App.js — application shell and routing
  - src/components/SeatingChart.js — seating renderer and request UI
  - src/components/Table6.js — 6-seat table visual component
  - src/admin/RequestsModule.js — admin UI for reviewing seat requests
- database/: SQL schema files for initial setup

Key concepts & data shapes
--------------------------
- Seating rows (DB table `seating`): represent either traditional rows or grouped
  seat types (e.g., `table-6`). Important fields:
  - id, event_id
  - section (text), row_label (text)
  - total_seats (integer)
  - seat_type (string), is_active (boolean)
  - selected_seats (JSON) — an array of seat ids that are reserved (persisted)
  - pos_x, pos_y, rotation — used by frontend to position components

- Seat id string format: SECTION-ROW-<seatNumber> (e.g. "Main-A-3").
  The codebase splits these strings to find the seating row; be careful if
  section or row labels contain hyphens.

Seat request lifecycle
----------------------
1. Customer selects seats on the `SeatingChart` and submits a seat request.
   The frontend POSTs `/api/seat-requests` with the selected seat ids and
   contact information. The server stores the request with status `pending`.
2. Admins review pending requests in the `RequestsModule`. On approve the
   server runs a transaction that:
   - Loads the seat_request and parses `selected_seats`.
   - Checks each seat against the seating row's `selected_seats` JSON.
   - If conflicts are detected, returns 409 with a list of conflicting seat ids.
   - Otherwise, merges the seat ids into the appropriate seating.selected_seats
     JSON fields and marks the request `approved`.
3. After approval the seats are considered reserved and the public UI shows
   them as reserved (red).

Developer workflows
-------------------
- Start backend:
  - Ensure `backend/.env` has DB credentials
  - cd backend
  - npm install
  - node server.js

- Start frontend:
  - cd frontend
  - npm install
  - npm start

Testing & debugging tips
------------------------
- Use temporary files for complex JSON payloads when hitting the API from
  the shell to avoid quoting issues.
- If you plan to change the seat id format, update both frontend and backend
  parsing logic. A structured object with section/row/seat numeric fields
  is more robust than a hyphen-delimited string.
- For race-condition prone flows consider `SELECT ... FOR UPDATE` or using
  a row-level lock when approving requests.

Extending the system
--------------------
- Add temporary holds: create `seat_holds` table with expiry and expose
  endpoints to create/release holds; update frontend to display holds.
- Add admin bulk approvals with a dry-run conflict check.
- Replace string seat ids with an explicit model: seating_row_id + seat_index
  to make joins and queries simpler and avoid hyphen parsing.

Contact & notes
---------------
If you need help understanding a function or transaction, open an issue or
ping the maintainer listed in `README.md`.
