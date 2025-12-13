# Schedule & Seating Alignment Note

- **Recurring series vs. reservations**  
  The new schedule layout groups recurring masters into a single card on the public site, but every reservation still anchors to a concrete event instance (`events.id`). When a visitor selects seats, the request API receives the specific occurrence ID (not the master), so seat holds/finalization continue to happen per-date.

- **Next-occurrence logic**  
  The “Next occurrence” label in the Recurring section is computed by grouping published child events (`series_master_id` > 0) and sorting by `start_datetime`. Seating-enabled series inherit the correct layout metadata because each occurrence already stores `layout_id` + `layout_version_id` at creation time. If a given occurrence toggles seating on/off, only that event’s seat map is affected.

- **Seat chart versioning guarantees**  
  The schema still requires `seat_requests.layout_version_id` and `events.layout_version_id`. Even though recurring masters don’t surface every child row, the importer/CRUD flows continue to stamp the current layout version into each event. When a reservation is created, the API copies the event’s version ID into `seat_requests` plus a JSON snapshot (`seat_map_snapshot`), so later chart edits never corrupt existing holds.

- **Seat states & holds**  
  No code changes were required to the seating tables: seat states (`status` ENUM) still support `available`, `hold`, `finalized`, etc., and the backend timers continue to expire holds after 24 hours. The UI refactor simply reduces visual noise; the admin panel still lists every individual reservation request, including those that originate from recurring cards.

- **Cutover safety**  
  Because the API responses are unchanged (only the grouping logic in `HomePage` changed), existing admin flows for assigning layouts, running holds, and finalizing seats remain 1:1. Future seating enhancements can extend the same structure by attaching additional metadata to masters without altering the reservation foreign keys.

- **Editor metadata**  
  The seating layout editor now stores extra JSON (`canvas_settings`, marker/object definitions) alongside `layout_data`. These fields live in `seating_layouts.canvas_settings` (and the matching versions table) so older layouts keep working, but admins gain zoom/pan presets, markers, and standard objects without schema breakage.
