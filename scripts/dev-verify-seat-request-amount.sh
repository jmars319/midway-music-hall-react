#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"

auto_now="$(date -u +%s)"
created_event_ids=()

cleanup() {
  if [ "${#created_event_ids[@]}" -gt 0 ]; then
    for event_id in "${created_event_ids[@]}"; do
      curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    done
  fi
}
trap cleanup EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

json_field() {
  local json="$1"
  local field="$2"
  JSON_INPUT="$json" python3 - "$field" <<'PY'
import json
import os
import sys

value = json.loads(os.environ.get('JSON_INPUT', '{}'))
for part in sys.argv[1].split('.'):
    if isinstance(value, list):
        value = value[int(part)]
    else:
        value = value.get(part)
if value is None:
    print('null')
elif isinstance(value, bool):
    print('true' if value else 'false')
else:
    print(value)
PY
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

layout_id="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$id = (int) \$pdo->query('SELECT id FROM seating_layouts ORDER BY id ASC LIMIT 1')->fetchColumn();
echo \$id;
")"

if [ -z "$layout_id" ] || [ "$layout_id" = "0" ]; then
  log_error "no seating_layouts found"
  exit 1
fi

create_event() {
  local title="$1"
  local ticket_price="$2"
  local payload
  payload=$(cat <<JSON
{
  "artist_name": "${title}",
  "event_date": "$(date -u +%F)",
  "event_time": "20:00:00",
  "door_time": "$(date -u +%F) 18:00:00",
  "timezone": "America/New_York",
  "status": "draft",
  "visibility": "private",
  "ticket_type": "reserved_seating",
  "layout_id": ${layout_id},
  "seating_enabled": true,
  "ticket_price": ${ticket_price}
}
JSON
)
  local response
  response="$(post_json "POST" "/events" "$payload")"
  local event_id
  event_id="$(json_field "$response" id)"
  if [ "$event_id" = "null" ] || [ -z "$event_id" ]; then
    log_error "failed to create test event: $response"
    exit 1
  fi
  created_event_ids+=("$event_id")
  printf '%s\n' "$event_id"
}

submit_request() {
  local event_id="$1"
  local response
  response="$(post_json "POST" "/seat-requests" "$(cat <<JSON
{
  "event_id": ${event_id},
  "customer_name": "Amount Verify",
  "contact": {
    "email": "amount-verify@example.com",
    "phone": "555-555-1111"
  },
  "selected_seats": ["Amount-${event_id}-1", "Amount-${event_id}-2"],
  "special_requests": ""
}
JSON
)")"
  printf '%s\n' "$response"
}

log_step "[seat-request-amount] verifying computed total_amount when ticket_price is set"
priced_event_id="$(create_event "Amount Verify Priced ${auto_now}" "12.00")"
priced_response="$(submit_request "$priced_event_id")"
priced_success="$(json_field "$priced_response" success)"
if [ "$priced_success" != "true" ]; then
  log_error "priced request submission failed: $priced_response"
  exit 1
fi
priced_total="$(json_field "$priced_response" seat_request.total_amount)"
priced_currency="$(json_field "$priced_response" seat_request.currency)"
if [ "$priced_total" != "24.00" ]; then
  log_error "expected total_amount 24.00, got ${priced_total}"
  exit 1
fi
if [ "$priced_currency" != "USD" ]; then
  log_error "expected currency USD, got ${priced_currency}"
  exit 1
fi

log_step "[seat-request-amount] verifying NULL total_amount when pricing is unavailable"
unpriced_event_id="$(create_event "Amount Verify Unpriced ${auto_now}" "null")"
unpriced_response="$(submit_request "$unpriced_event_id")"
unpriced_success="$(json_field "$unpriced_response" success)"
if [ "$unpriced_success" != "true" ]; then
  log_error "unpriced request submission failed: $unpriced_response"
  exit 1
fi
unpriced_total="$(json_field "$unpriced_response" seat_request.total_amount)"
if [ "$unpriced_total" != "null" ]; then
  log_error "expected total_amount null when pricing missing, got ${unpriced_total}"
  exit 1
fi

log_success "[seat-request-amount] total_amount scaffolding verified"
