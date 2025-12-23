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

event_id=""
cleanup() {
  if [ -n "$event_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    event_id=""
  fi
}
trap cleanup EXIT

now_date="$(date -u +%F)"
door_time="$(date -u '+%F 18:00:00')"
create_payload=$(cat <<JSON
{
  "artist_name": "Verify Recurring $(date +%s)",
  "event_date": "${now_date}",
  "event_time": "20:00:00",
  "door_time": "${door_time}",
  "timezone": "America/New_York",
  "status": "draft",
  "visibility": "private",
  "ticket_type": "general_admission",
  "series_schedule_label": "Fridays · 6:00 – 10:00 PM",
  "series_summary": "Community dance night",
  "series_footer_note": "Weekly test footer"
}
JSON
)

create_response=$(post_json "POST" "/events" "$create_payload")
event_id="$(json_field "$create_response" id)"
echo "[recurring-api] created event ${event_id}"

php -r "if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; } require \$argv[1]; \$pdo = \\Midway\\Backend\\Database::connection(); \$stmt = \$pdo->prepare('UPDATE events SET is_series_master = 1, start_datetime = NULL, end_datetime = NULL, event_date = NULL, event_time = NULL, door_time = NULL WHERE id = ?'); \$stmt->execute([(int) \$argv[2]]);" "$ROOT_DIR/backend/bootstrap.php" "$event_id"

meta_only_payload=$(cat <<JSON
{
  "series_schedule_label": "Updated schedule label",
  "series_summary": "Updated recurring summary",
  "series_footer_note": "Updated footer note"
}
JSON
)
post_json "PUT" "/events/${event_id}" "$meta_only_payload" >/dev/null

event_response=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/events/${event_id}")
summary_value="$(json_field "$event_response" 'event.series_summary')"
footer_value="$(json_field "$event_response" 'event.series_footer_note')"
schedule_value="$(json_field "$event_response" 'event.series_schedule_label')"

if [ "$summary_value" != "Updated recurring summary" ] || [ "$footer_value" != "Updated footer note" ] || [ "$schedule_value" != "Updated schedule label" ]; then
  echo "ERROR: recurring metadata did not round-trip through API." >&2
  exit 1
fi

echo "[recurring-api] metadata round-trip verified"
