#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
created_event_id=""

cleanup_event() {
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
    created_event_id=""
  fi
}
trap cleanup_event EXIT

require_backend_health_once || {
  echo "ERROR: backend is not running; start dev stack via scripts/dev-start.sh" >&2
  exit 1
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

event_title="Clearable Fields $(date +%s)"
event_date="$(date -u +%F)"
door_time="$(date -u -v+0H '+%F 18:00:00' 2>/dev/null || date -u '+%F 18:00:00')"
create_payload=$(cat <<JSON
{
  "artist_name": "${event_title}",
  "title": "${event_title}",
  "event_date": "${event_date}",
  "event_time": "20:00:00",
  "door_time": "${door_time}",
  "timezone": "America/New_York",
  "status": "draft",
  "visibility": "private",
  "seating_enabled": false,
  "ticket_type": "general_admission"
}
JSON
)

echo "[clearable] creating temporary event"
create_response=$(post_json "POST" "/events" "$create_payload")
created_event_id=$(printf '%s' "$create_response" | python3 -c 'import json,sys;data=json.load(sys.stdin);print(data.get("id"))')
if [ -z "$created_event_id" ]; then
  echo "ERROR: failed to create event" >&2
  exit 1
fi

echo "[clearable] setting fields to non-null values"
set_payload=$(cat <<JSON
{
  "contact_notes": "test-notes",
  "ticket_price": "20",
  "door_price": "25",
  "min_ticket_price": "20",
  "max_ticket_price": "25",
  "ticket_url": "https://example.com/verify-clearable",
  "change_note": "clearable verify set"
}
JSON
)
post_json "PUT" "/events/${created_event_id}" "$set_payload" >/dev/null

fetch_event() {
  curl -fsS -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}"
}

assert_state() {
  local json="$1"
  local mode="$2"
  JSON_DATA="$json" python3 - "$mode" <<'PY'
from decimal import Decimal, InvalidOperation
import json, os, sys

mode = sys.argv[1]
raw = os.environ.get('JSON_DATA', '')
if not raw:
    raise SystemExit('missing event payload')
data = json.loads(raw)
event = data.get('event') or {}
expected_name = event.get('artist_name')
if not expected_name or 'Clearable Fields' not in expected_name:
    raise SystemExit('artist_name mutated or missing')

amount_keys = {
    'ticket_price': Decimal('20.00'),
    'door_price': Decimal('25.00'),
    'min_ticket_price': Decimal('20.00'),
    'max_ticket_price': Decimal('25.00'),
}

def parse_decimal(value, key):
    if value in (None, ''):
        raise SystemExit(f"{key} missing or empty (got {value!r})")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise SystemExit(f"invalid decimal for {key}: {value!r} ({exc})")
    return parsed.quantize(Decimal('0.01'))

if mode == 'set':
    if event.get('contact_notes') != 'test-notes':
        raise SystemExit(f"expected contact_notes='test-notes', got {event.get('contact_notes')!r}")
    if event.get('ticket_url') != 'https://example.com/verify-clearable':
        raise SystemExit(f"expected ticket_url to match test link, got {event.get('ticket_url')!r}")
    for key, expected in amount_keys.items():
        actual_value = event.get(key)
        actual_decimal = parse_decimal(actual_value, key)
        if actual_decimal != expected:
            raise SystemExit(f"expected {key}={expected}, got {actual_value!r}")
elif mode == 'cleared':
    for key in list(amount_keys.keys()) + ['contact_notes', 'ticket_url']:
        if event.get(key) is not None:
            raise SystemExit(f"expected {key}=null, got {event.get(key)!r}")
else:
    raise SystemExit('unknown mode')
PY
}

set_state_json=$(fetch_event)
assert_state "$set_state_json" "set"

echo "[clearable] clearing fields via empty payload"
clear_payload=$(cat <<JSON
{
  "contact_notes": "",
  "ticket_price": "",
  "door_price": "",
  "min_ticket_price": "",
  "max_ticket_price": "",
  "ticket_url": "",
  "change_note": "clearable verify cleared"
}
JSON
)
post_json "PUT" "/events/${created_event_id}" "$clear_payload" >/dev/null

cleared_json=$(fetch_event)
assert_state "$cleared_json" "cleared"

echo "[clearable] verification succeeded"
