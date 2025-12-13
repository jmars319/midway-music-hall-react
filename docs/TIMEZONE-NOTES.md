## Timezone Notes

Notes about server timezone handling and MySQL `CONVERT_TZ` behavior.

- If MySQL timezone tables are not populated, `CONVERT_TZ` may return NULL
- Fallbacks: use `NOW()` or populate timezone tables via `mysql_tzinfo_to_sql`
# Timezone Filters & Known Constraints

## Background
- The events API originally used `CONVERT_TZ(NOW(), 'UTC', 'America/New_York')` inside SQL filters to hide past events.
- The GoDaddy MySQL build does **not** have timezone tables loaded, so `CONVERT_TZ(...)` returns `NULL`.
- As soon as that operand became `NULL`, any comparison such as `event_end >= NULL` evaluated to `UNKNOWN` and filtered out every row, which is why both the public site and admin UI stopped showing events.

## Fix that shipped (2025‑02‑15)
- We changed the filter expression to plain `NOW()` so MySQL always returns a concrete datetime even without timezone tables.
- This keeps the existing data (all timestamps are already stored in Eastern) and restores the “Upcoming vs Past” logic immediately.
- Trade‑off: `NOW()` now reflects the database server’s timezone. On shared hosting that’s typically already Eastern, but if the provider changes it the “upcoming” cutoff could drift a few hours.

## Future‑proof options (pick one per environment)
1. **Preferred:** Store all datetimes in UTC (or convert to UTC during insert) and let PHP format them in Eastern when rendering. Then the SQL filter is just `WHERE end_datetime >= UTC_TIMESTAMP()`.
2. Explicitly set the connection timezone after connecting, e.g. `SET time_zone = 'America/New_York';`. This still requires the timezone tables to be installed.
3. Ask the host to load MySQL timezone tables (or run `mysql_tzinfo_to_sql`) so `CONVERT_TZ` works everywhere.

Until one of the future options is implemented, keep relying on `NOW()` and make sure the hosting panel stays on US Eastern.***
