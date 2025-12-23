#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"

require_backend_health_once || {
  echo "ERROR: backend is not running; start the dev stack before running this script." >&2
  exit 1
}

json_field() {
  local json="$1"
  local field="$2"
  JSON_INPUT="$json" python3 - "$field" <<'PYCODE'
import json
import os
import sys

field = sys.argv[1]
try:
    data = json.loads(os.environ.get("JSON_INPUT", ""))
except Exception as exc:
    raise SystemExit(f"invalid json: {exc}")

for part in field.split('.'):
    if isinstance(data, dict) and part in data:
        data = data[part]
    else:
        raise SystemExit(f"missing field: {field}")

if isinstance(data, bool):
    print("true" if data else "false")
elif data is None:
    print('null')
else:
    print(data)
PYCODE
}

post_json() {
  local method="$1"
  local path="$2"
  local body="$3"
  curl -fsS -X "$method" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$body" \
    "${API_BASE}${path}"
}

layout_pair="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$rows = \$pdo->query('SELECT id FROM seating_layouts ORDER BY id ASC')->fetchAll(PDO::FETCH_COLUMN);
if (!\$rows) {
    throw new RuntimeException('No seating layouts found.');
}
\$primary = (int) \$rows[0];
\$alternate = null;
if (count(\$rows) > 1) {
    \$alternate = (int) \$rows[1];
}
if (!\$alternate) {
    \$stmt = \$pdo->prepare('SELECT name, description, layout_data, stage_position, stage_size, canvas_settings FROM seating_layouts WHERE id = ? LIMIT 1');
    \$stmt->execute([\$primary]);
    \$row = \$stmt->fetch();
    if (!\$row) {
        throw new RuntimeException('Unable to load base layout.');
    }
    \$newName = (\$row['name'] ?? 'Layout') . ' (Guardrail Copy)';
    \$insert = \$pdo->prepare('INSERT INTO seating_layouts (name, description, is_default, layout_data, stage_position, stage_size, canvas_settings) VALUES (?, ?, 0, ?, ?, ?, ?)');
    \$insert->execute([\$newName, \$row['description'] ?? null, \$row['layout_data'], \$row['stage_position'], \$row['stage_size'], \$row['canvas_settings']]);
    \$alternate = (int) \$pdo->lastInsertId();
}
echo \$primary . ',' . \$alternate;
")"

primary_layout_id="${layout_pair%%,*}"
alternate_layout_id="${layout_pair##*,}"

if [ -z "$primary_layout_id" ] || [ -z "$alternate_layout_id" ]; then
  echo "ERROR: unable to resolve seating layouts." >&2
  exit 1
fi

now_date="$(date -u +%F)"
door_time="$(date -u '+%F 17:00:00')"

create_payload=$(cat <<JSON
{
  "artist_name": "Seating Guardrail $(date +%s)",
  "event_date": "${now_date}",
  "event_time": "20:00:00",
  "door_time": "${door_time}",
  "timezone": "America/New_York",
  "status": "draft",
  "visibility": "private",
  "ticket_type": "reserved_seating",
  "layout_id": ${primary_layout_id},
  "seating_enabled": true
}
JSON
)

event_id=""
cleanup() {
  if [ -n "$event_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    event_id=""
  fi
}
trap cleanup EXIT

create_response=$(post_json "POST" "/events" "$create_payload")
event_id="$(json_field "$create_response" id)"
echo "[seating-guardrails] created event ${event_id}"

layout_version_id="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$stmt = \$pdo->prepare('SELECT layout_version_id FROM events WHERE id = ? LIMIT 1');
\$stmt->execute([(int) \$argv[1]]);
\$row = \$stmt->fetch();
echo \$row ? ((int) \$row['layout_version_id']) : 0;
" "$event_id")"

if [ -z "$layout_version_id" ] || [ "$layout_version_id" = "0" ]; then
  echo "ERROR: event missing layout_version_id" >&2
  exit 1
fi

php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$seatLabel = 'Guardrail-A-1';
\$pdo->prepare('INSERT INTO seat_requests (event_id, layout_version_id, customer_name, customer_email, selected_seats, total_seats, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    ->execute([(int) \$argv[1], (int) \$argv[2], 'Guardrail QA', 'guardrail@example.com', json_encode([\$seatLabel]), 1, 'confirmed', 'guardrail-script', 'guardrail-script']);
\$pdo->prepare('INSERT INTO seating (event_id, layout_id, section, row_label, seat_number, total_seats, seat_type, is_active, selected_seats, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    ->execute([(int) \$argv[1], (int) \$argv[3], 'Guardrail', 'A', 1, 1, 'table-6', 1, json_encode([\$seatLabel]), 'reserved']);
" "$event_id" "$layout_version_id" "$primary_layout_id"

count_metric() {
  local table="$1"
  php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$stmt = \$pdo->prepare('SELECT COUNT(*) FROM ${table} WHERE event_id = ?');
\$stmt->execute([(int) \$argv[1]]);
echo (int) \$stmt->fetchColumn();
" "$2"
}

initial_requests_count="$(count_metric 'seat_requests' "$event_id")"
initial_seating_count="$(count_metric 'seating' "$event_id")"

post_json "PUT" "/events/${event_id}" '{"seating_enabled": false}' >/dev/null
post_json "PUT" "/events/${event_id}" '{"seating_enabled": true}' >/dev/null

event_payload=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/events/${event_id}")
layout_after_toggle="$(json_field "$event_payload" 'event.layout_id')"
version_after_toggle="$(json_field "$event_payload" 'event.layout_version_id')"

if [ "$layout_after_toggle" != "$primary_layout_id" ] || [ "$version_after_toggle" != "$layout_version_id" ]; then
  echo "ERROR: layout fields changed after seating_enabled toggles." >&2
  exit 1
fi

post_toggle_requests="$(count_metric 'seat_requests' "$event_id")"
post_toggle_seating="$(count_metric 'seating' "$event_id")"

if [ "$post_toggle_requests" != "$initial_requests_count" ] || [ "$post_toggle_seating" != "$initial_seating_count" ]; then
  echo "ERROR: seating data changed after seating_enabled toggles." >&2
  exit 1
fi

change_payload="{\"layout_id\": ${alternate_layout_id}}"
change_response=$(post_json "PUT" "/events/${event_id}" "$change_payload")
snapshot_id="$(json_field "$change_response" 'seating_snapshot_id')"

if [ "$snapshot_id" = "null" ] || [ -z "$snapshot_id" ]; then
  echo "ERROR: layout change did not report a snapshot id." >&2
  exit 1
fi

snapshot_check="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$stmt = \$pdo->prepare('SELECT snapshot_type, reserved_seats FROM event_seating_snapshots WHERE id = ? AND event_id = ? LIMIT 1');
\$stmt->execute([(int) \$argv[1], (int) \$argv[2]]);
\$row = \$stmt->fetch(PDO::FETCH_ASSOC);
if (!\$row) { echo 'missing'; return; }
\$reserved = json_decode(\$row['reserved_seats'] ?? '[]', true) ?: [];
echo \$row['snapshot_type'] . '|' . (in_array('Guardrail-A-1', \$reserved, true) ? 'has_seat' : 'missing_seat');
" "$snapshot_id" "$event_id")"

if [[ "$snapshot_check" != pre_layout_change* ]] || [[ "$snapshot_check" != *has_seat ]]; then
  echo "ERROR: snapshot validation failed (${snapshot_check})." >&2
  exit 1
fi

post_change_requests="$(count_metric 'seat_requests' "$event_id")"
post_change_seating="$(count_metric 'seating' "$event_id")"

if [ "$post_change_requests" != "$initial_requests_count" ] || [ "$post_change_seating" != "$initial_seating_count" ]; then
  echo "ERROR: seating data changed after layout switch." >&2
  exit 1
fi

echo "[seating-guardrails] seating toggles left layout + reservations intact"
echo "[seating-guardrails] snapshot #${snapshot_id} captured before layout change"

php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$pdo->prepare('DELETE FROM seat_requests WHERE event_id = ?')->execute([(int) \$argv[1]]);
\$pdo->prepare('UPDATE seating SET selected_seats = NULL WHERE event_id = ?')->execute([(int) \$argv[1]]);
" "$event_id"

if [ "$(count_metric 'seat_requests' "$event_id")" != "0" ]; then
  echo "ERROR: failed to wipe seat_requests prior to restore test." >&2
  exit 1
fi

restore_payload="{\"snapshot_id\": ${snapshot_id}}"
restore_response=$(post_json "POST" "/events/${event_id}/restore-seating-snapshot" "$restore_payload")
restored_flag="$(json_field "$restore_response" 'restored')"

if [ "$restored_flag" != "true" ]; then
  echo "ERROR: restore endpoint failed: $restore_response" >&2
  exit 1
fi

restored_layout="$(json_field "$restore_response" 'layout_id')"
if [ "$restored_layout" != "$primary_layout_id" ]; then
  echo "ERROR: restore did not realign layout_id (expected $primary_layout_id, got $restored_layout)." >&2
  exit 1
fi

restored_requests="$(count_metric 'seat_requests' "$event_id")"
if [ "$restored_requests" -lt "$initial_requests_count" ]; then
  echo "ERROR: restore did not repopulate seat_requests (have $restored_requests, expected >= $initial_requests_count)." >&2
  exit 1
fi

conflict_count="$(JSON_INPUT="$restore_response" python3 - <<'PYCODE'
import json
import os
data = json.loads(os.environ.get("JSON_INPUT", "{}"))
conflicts = data.get("details", {}).get("conflicts", []) or []
print(len(conflicts))
PYCODE
)"

if [ "$conflict_count" != "0" ]; then
  echo "ERROR: restore reported unexpected conflicts: $restore_response" >&2
  exit 1
fi

echo "[seating-guardrails] restore endpoint rebuilt reservations and layout successfully"
