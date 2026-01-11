#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-pay-verify.XXXXXX")"

created_layout_id=""
created_event_ids=()
target_category_id=""
target_category_name=""
original_payment_config_b64=""
original_global_config_b64=""
restore_config_needed=0
restore_global_needed=0

cleanup_resources() {
  if [ "${#created_event_ids[@]}" -gt 0 ]; then
    for event_id in "${created_event_ids[@]}"; do
      curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    done
  fi
  if [ -n "$created_layout_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/seating-layouts/${created_layout_id}" >/dev/null 2>&1 || true
  fi
  if [ "$restore_config_needed" -eq 1 ] && [ -n "$target_category_id" ]; then
    python3 - "$original_payment_config_b64" "$target_category_id" "$API_BASE" <<'PY'
import base64, json, sys, urllib.request
raw = sys.argv[1]
category_id = int(sys.argv[2])
api_base = sys.argv[3]
payload = {
    'scope': 'category',
    'category_id': category_id,
    'enabled': False,
    'payment_url': '',
    'button_text': 'Pay Online',
    'limit_seats': 2,
    'over_limit_message': '',
    'fine_print': '',
    'provider_label': '',
}
if raw:
    data = json.loads(base64.b64decode(raw.encode()).decode())
    payload.update({
        'enabled': bool(data.get('enabled')),
        'payment_url': data.get('payment_url') or '',
        'button_text': data.get('button_text') or 'Pay Online',
        'limit_seats': data.get('limit_seats') or 2,
        'over_limit_message': data.get('over_limit_message') or '',
        'fine_print': data.get('fine_print') or '',
        'provider_label': data.get('provider_label') or '',
    })
body = json.dumps(payload).encode()
req = urllib.request.Request(f"{api_base}/admin/payment-settings", data=body, headers={'Content-Type': 'application/json'}, method='PUT')
try:
    urllib.request.urlopen(req).read()
except Exception as exc:  # pragma: no cover
    sys.stderr.write(f"[cleanup] Failed to restore payment config: {exc}\n")
PY
  fi
  if [ "$restore_global_needed" -eq 1 ]; then
    python3 - "$original_global_config_b64" "$API_BASE" <<'PY'
import base64, json, sys, urllib.request
raw = sys.argv[1]
api_base = sys.argv[2]
payload = {
    'scope': 'global',
    'enabled': False,
    'payment_url': '',
    'button_text': 'Pay Online',
    'limit_seats': 2,
    'over_limit_message': '',
    'fine_print': '',
    'provider_label': '',
}
if raw:
    data = json.loads(base64.b64decode(raw.encode()).decode())
    payload.update({
        'enabled': bool(data.get('enabled')),
        'payment_url': data.get('payment_url') or '',
        'button_text': data.get('button_text') or 'Pay Online',
        'limit_seats': data.get('limit_seats') or 2,
        'over_limit_message': data.get('over_limit_message') or '',
        'fine_print': data.get('fine_print') or '',
        'provider_label': data.get('provider_label') or '',
    })
body = json.dumps(payload).encode()
req = urllib.request.Request(f"{api_base}/admin/payment-settings", data=body, headers={'Content-Type': 'application/json'}, method='PUT')
try:
    urllib.request.urlopen(req).read()
except Exception as exc:  # pragma: no cover
    sys.stderr.write(f"[cleanup] Failed to restore global payment config: {exc}\n")
PY
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup_resources EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

json_field() {
  local json="$1"
  local field="$2"
  printf '%s' "$json" | python3 -c 'import json, sys
data = json.load(sys.stdin)
value = data
for part in sys.argv[1].split("."):
    if isinstance(value, list):
        idx = int(part)
        value = value[idx]
    else:
        value = value.get(part)
print(value)' "$field"
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

log_step "[payment-verify] locating a category for testing"
category_response=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/event-categories")
target_category_id=$(CATEGORY_JSON="$category_response" python3 - <<'PY'
import json, os
data = json.loads(os.environ.get('CATEGORY_JSON', '{}'))
for item in data.get('categories', []):
    if item.get('is_active', 1):
        print(item['id'])
        break
PY
)
if [ -z "$target_category_id" ]; then
  log_error "no event categories available for testing"
  exit 1
fi
target_category_name=$(CATEGORY_JSON="$category_response" python3 - "$target_category_id" <<'PY'
import json, os, sys
target = sys.argv[1]
data = json.loads(os.environ.get('CATEGORY_JSON', '{}'))
for item in data.get('categories', []):
    if str(item.get('id')) == str(target):
        print(item.get('name', f'Category {target}'))
        break
PY
)

log_step "[payment-verify] capturing original payment config for category ${target_category_name}"
payment_response=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/admin/payment-settings")
has_payment_table=$(PAYMENT_JSON="$payment_response" python3 - <<'PY'
import json, os
data = json.loads(os.environ.get('PAYMENT_JSON', '{}'))
print('1' if data.get('has_table') else '0')
PY
)
if [ "$has_payment_table" != "1" ]; then
  log_error "payment_settings table not detected. Run database/20250326_payment_settings.sql + database/20251212_schema_upgrade.sql before this script."
  exit 1
fi
original_payment_config_b64=$(PAYMENT_JSON="$payment_response" python3 - "$target_category_id" <<'PY'
import base64, json, os, sys
data = json.loads(os.environ.get('PAYMENT_JSON', '{}'))
target = sys.argv[1]
for item in data.get('payment_settings', []):
    if str(item.get('category_id')) == str(target) and item.get('scope') == 'category':
        print(base64.b64encode(json.dumps(item).encode()).decode())
        break
else:
    print('')
PY
)
original_global_config_b64=$(python3 - <<'PY'
import base64, json, sys
data = json.loads(sys.stdin.read() or '{}')
for item in data.get('payment_settings', []):
    if item.get('scope') == 'global':
        print(base64.b64encode(json.dumps(item).encode()).decode())
        break
else:
    print('')
PY
<<<"$payment_response")

put_payment_config() {
  local enabled="$1"
  local payment_url="$2"
  local button_text="$3"
  local limit="$4"
  local over_limit="$5"
  local fine_print="$6"
  local provider_label="$7"
  local payload
  payload=$(cat <<JSON
{
  "scope": "category",
  "category_id": ${target_category_id},
  "enabled": ${enabled},
  "payment_url": "${payment_url}",
  "button_text": "${button_text}",
  "limit_seats": ${limit},
  "over_limit_message": "${over_limit}",
  "fine_print": "${fine_print}",
  "provider_label": "${provider_label}"
}
JSON
)
  post_json "PUT" "/admin/payment-settings" "$payload" >/dev/null
  restore_config_needed=1
}

disable_global_config() {
  local payload
  payload=$(python3 - "$original_global_config_b64" <<'PY'
import base64, json, sys
raw = sys.argv[1]
if raw:
    data = json.loads(base64.b64decode(raw.encode()).decode())
    payload = {
        'scope': 'global',
        'enabled': False,
        'payment_url': data.get('payment_url') or '',
        'button_text': data.get('button_text') or 'Pay Online',
        'limit_seats': data.get('limit_seats') or 2,
        'over_limit_message': data.get('over_limit_message') or '',
        'fine_print': data.get('fine_print') or '',
        'provider_label': data.get('provider_label') or '',
    }
else:
    payload = {
        'scope': 'global',
        'enabled': False,
        'payment_url': '',
        'button_text': 'Pay Online',
        'limit_seats': 2,
        'over_limit_message': '',
        'fine_print': '',
        'provider_label': '',
    }
print(json.dumps(payload))
PY
)
  post_json "PUT" "/admin/payment-settings" "$payload" >/dev/null
  restore_global_needed=1
}

create_layout() {
  local now label payload response
  now=$(date +%s)
  label="Verify Layout ${now}"
  payload=$(cat <<JSON
{
  "name": "${label}",
  "description": "payment verify layout",
  "layout_data": [
    {
      "id": "verify-table",
      "element_type": "table-4",
      "label": "Verify Table",
      "section_name": "Verify",
      "seat_type": "general",
      "total_seats": 4,
      "pos_x": 20,
      "pos_y": 20,
      "rotation": 0,
      "width": 140,
      "height": 140,
      "color": "#a855f7",
      "seat_labels": {}
    }
  ],
  "canvas_settings": { "preset": "standard", "width": 800, "height": 600 }
}
JSON
)
  response=$(post_json "POST" "/seating-layouts" "$payload")
  created_layout_id=$(json_field "$response" id)
  log_success "[payment-verify] created seating layout ${created_layout_id}"
}

create_event() {
  local label="$1"
  local payment_flag="$2"
  local event_date door_time payload response event_id
  event_date="$(date -u -d '+2 days' +%F 2>/dev/null || date -u +%F)"
  door_time="${event_date} 18:00:00"
  payload=$(cat <<JSON
{
  "artist_name": "${label}",
  "title": "${label}",
  "event_date": "${event_date}",
  "event_time": "20:00:00",
  "door_time": "${door_time}",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "payment_enabled": ${payment_flag},
  "seating_enabled": true,
  "layout_id": ${created_layout_id},
  "category_id": ${target_category_id},
  "ticket_type": "reserved_seating"
}
JSON
)
  response=$(post_json "POST" "/events" "$payload")
  event_id=$(json_field "$response" id)
  created_event_ids+=("$event_id")
  log_info "[payment-verify] created event ${event_id} (${label})"
  printf '%s\n' "$event_id"
}

assert_payment_state() {
  local events_json="$1"
  local event_id="$2"
  local expect_present="$3"
  local expect_limit="$4"
  python3 - "$events_json" "$event_id" "$expect_present" "$expect_limit" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
target = int(sys.argv[2])
expect_present = sys.argv[3] == '1'
expect_limit = int(sys.argv[4]) if sys.argv[4] != '0' else None
for event in payload.get('events', []):
    if int(event.get('id', 0)) == target:
        payment = event.get('payment_option')
        if expect_present and not payment:
            raise SystemExit(f"payment_option missing for event {target}")
        if not expect_present and payment:
            raise SystemExit(f"payment_option unexpectedly present for event {target}")
        if expect_present and expect_limit is not None:
            limit = payment.get('limit_seats')
            if int(limit) != expect_limit:
                raise SystemExit(f"payment_option limit mismatch for event {target}: {limit} != {expect_limit}")
        break
else:
    raise SystemExit(f"event {target} not found in response")
PY
}

TEST_PAYMENT_URL="https://example.com/pay-test"
TEST_BUTTON="Pay with TestLink"
TEST_OVER_LIMIT="Please call us for groups over 2 seats."
TEST_FINE_PRINT="Verification link only."

disable_global_config

put_payment_config "true" "$TEST_PAYMENT_URL" "$TEST_BUTTON" 2 "$TEST_OVER_LIMIT" "$TEST_FINE_PRINT" "Test Provider"

create_layout

event_one_id=$(create_event "Verify Payment Enabled" "true")
event_two_id=$(create_event "Verify Payment Disabled" "false")

events_payload=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/public/events?limit=500&timeframe=all&archived=all")
assert_payment_state "$events_payload" "$event_one_id" "1" "2"
log_success "[payment-verify] payment config present for event ${event_one_id}"
assert_payment_state "$events_payload" "$event_two_id" "0" "0"
log_success "[payment-verify] payment config omitted for event ${event_two_id} (payment disabled)"

log_step "[payment-verify] disabling payment config for category"
put_payment_config "false" "$TEST_PAYMENT_URL" "$TEST_BUTTON" 2 "$TEST_OVER_LIMIT" "$TEST_FINE_PRINT" "Test Provider"

event_three_id=$(create_event "Verify Config Disabled" "true")
events_payload_disabled=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/public/events?limit=500&timeframe=all&archived=all")
assert_payment_state "$events_payload_disabled" "$event_three_id" "0" "0"
log_success "[payment-verify] payment config suppressed when category config disabled"

log_success "[payment-verify] completed successfully"
