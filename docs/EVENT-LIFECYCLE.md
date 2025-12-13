## Event Lifecycle

Documentation for event states, start/end resolution, and archive behavior.

- How `start_datetime`, `event_date`, and `event_time` are combined
- Archive policy and filters exposed by the API
# Event Lifecycle Notes

## Past vs Upcoming
- An event is considered **past** once its end time is earlier than the current time in US Eastern.
- End time resolution:
  1. Use `end_datetime` when provided.
  2. Otherwise, add 4 hours to `start_datetime`/`event_date + event_time`.
- This rule is shared by the API and frontend and is enforced when requesting `timeframe=upcoming` or `timeframe=past`.

## Archiving
- `archived_at` marks events that staff have manually archived via the admin panel.
- Archived events:
  - Never appear on public endpoints.
  - Remain available inside the admin “Archived” filter with all seat request history intact.
- Restoring an event clears `archived_at` and sets its status/visibility per the chosen values.

## API filters
- `timeframe=upcoming|past|all` — filters by the rule above.
- `archived=0|1|all` — default is `0` (exclude archived). Use `1` to fetch only archived rows.
- `page` + `limit` — provide pagination (default 200 per page).
