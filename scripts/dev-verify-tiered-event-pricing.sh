#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-tiered-pricing.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"

created_event_ids=()
created_layout_ids=()

cleanup() {
  if [ "${#created_event_ids[@]}" -gt 0 ]; then
    for event_id in "${created_event_ids[@]}"; do
      curl -fsS -X DELETE \
        -b "$ADMIN_COOKIE_JAR" \
        -H "Origin: ${ADMIN_ORIGIN}" \
        -H 'Accept: application/json' \
        "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    done
  fi
  if [ "${#created_layout_ids[@]}" -gt 0 ]; then
    for layout_id in "${created_layout_ids[@]}"; do
      curl -fsS -X DELETE \
        -b "$ADMIN_COOKIE_JAR" \
        -H "Origin: ${ADMIN_ORIGIN}" \
        -H 'Accept: application/json' \
        "${API_BASE}/seating-layouts/${layout_id}" >/dev/null 2>&1 || true
    done
  fi
  rm -rf "$TMP_DIR"
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

admin_post_json() {
  local method="$1"
  local path="$2"
  local body="$3"
  curl -fsS -X "$method" \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$body" \
    "${API_BASE}${path}"
}

admin_login() {
  local login_payload
  login_payload=$(python3 - "$ADMIN_LOGIN_ID" "$ADMIN_LOGIN_PASSWORD" <<'PY'
import json
import sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))
PY
)
  local login_response
  login_response=$(curl -fsS \
    -c "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$login_payload" \
    "${API_BASE}/login")
  local ok
  ok=$(LOGIN_JSON="$login_response" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ.get('LOGIN_JSON', '{}'))
print('1' if payload.get('success') else '0')
PY
)
  if [ "$ok" != "1" ]; then
    log_error "admin login failed in tiered pricing verify script"
    exit 1
  fi
}

future_event_date="$(date -u -v+2d +%F 2>/dev/null || date -u -d '+2 day' +%F)"
unique_suffix="$(date -u +%s)"

create_layout() {
  local payload
  payload=$(cat <<JSON
{
  "name": "Verify Tiered Pricing ${unique_suffix}",
  "description": "Verification layout for tiered event pricing",
  "is_default": false,
  "layout_data": [
    {
      "id": "tier-row-a",
      "element_type": "table",
      "section_name": "Tier",
      "row_label": "A",
      "total_seats": 2,
      "table_shape": "table-2",
      "is_active": true
    },
    {
      "id": "tier-row-b",
      "element_type": "table",
      "section_name": "Tier",
      "row_label": "B",
      "total_seats": 2,
      "table_shape": "table-2",
      "is_active": true
    },
    {
      "id": "tier-row-c",
      "element_type": "table",
      "section_name": "Tier",
      "row_label": "C",
      "total_seats": 2,
      "table_shape": "table-2",
      "is_active": true
    }
  ],
  "canvas_settings": {
    "width": 1200,
    "height": 800
  }
}
JSON
)
  local response
  response="$(admin_post_json "POST" "/seating-layouts" "$payload")"
  local layout_id
  layout_id="$(json_field "$response" id)"
  if [ "$layout_id" = "null" ] || [ -z "$layout_id" ]; then
    log_error "failed to create pricing verification layout: $response"
    exit 1
  fi
  created_layout_ids+=("$layout_id")
  printf '%s\n' "$layout_id"
}

create_tiered_event() {
  local layout_id="$1"
  local payload
  payload=$(cat <<JSON
{
  "artist_name": "Tiered Pricing Verify ${unique_suffix}",
  "event_date": "${future_event_date}",
  "event_time": "20:00:00",
  "door_time": "${future_event_date} 18:00:00",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${layout_id},
  "seating_enabled": true,
  "pricing_config": {
    "mode": "tiered",
    "tiers": [
      { "id": "vip", "label": "VIP", "price": 30.00, "note": "Closest seats", "color": "#F59E0B" },
      { "id": "premium", "label": "Premium", "price": 20.00, "note": "Center floor", "color": "#06B6D4" },
      { "id": "standard", "label": "Standard", "price": 10.00, "note": "Rear tables", "color": "#10B981" }
    ],
    "assignments": {
      "id:tier-row-a": "vip",
      "id:tier-row-b": "premium",
      "id:tier-row-c": "standard"
    }
  }
}
JSON
)
  local response
  response="$(admin_post_json "POST" "/events" "$payload")"
  local event_id
  event_id="$(json_field "$response" id)"
  if [ "$event_id" = "null" ] || [ -z "$event_id" ]; then
    log_error "failed to create tiered pricing event: $response"
    exit 1
  fi
  created_event_ids+=("$event_id")
  printf '%s\n' "$event_id"
}

fetch_event() {
  local event_id="$1"
  curl -fsS \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Accept: application/json' \
    "${API_BASE}/events/${event_id}"
}

submit_request() {
  local event_id="$1"
  local seats_json="$2"
  post_json "POST" "/seat-requests" "$(cat <<JSON
{
  "event_id": ${event_id},
  "customer_name": "Tier Verify",
  "contact": {
    "email": "tier-verify@example.com",
    "phone": "555-555-2222"
  },
  "selected_seats": ${seats_json},
  "special_requests": "Tiered pricing verification"
}
JSON
)"
}

admin_login

log_step "[tiered-pricing] creating dedicated layout + tiered event"
layout_id="$(create_layout)"
event_id="$(create_tiered_event "$layout_id")"

event_response="$(fetch_event "$event_id")"
event_success="$(json_field "$event_response" success)"
if [ "$event_success" != "true" ]; then
  log_error "failed to fetch created tiered event: $event_response"
  exit 1
fi

tier_count="$(json_field "$event_response" event.pricing_config.tiers)"
tier_count_value="$(EVENT_JSON="$event_response" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ.get('EVENT_JSON', '{}'))
tiers = (((payload.get('event') or {}).get('pricing_config') or {}).get('tiers') or [])
print(len(tiers))
PY
)"
if [ "$tier_count_value" != "3" ]; then
  log_error "expected 3 pricing tiers on create, got ${tier_count_value}"
  exit 1
fi

created_min="$(json_field "$event_response" event.min_ticket_price)"
created_max="$(json_field "$event_response" event.max_ticket_price)"
if [ "$created_min" != "10.00" ]; then
  log_error "expected tiered min_ticket_price 10.00, got ${created_min}"
  exit 1
fi
if [ "$created_max" != "30.00" ]; then
  log_error "expected tiered max_ticket_price 30.00, got ${created_max}"
  exit 1
fi

log_step "[tiered-pricing] verifying seat request total_amount uses row-tier prices"
tiered_request_response="$(submit_request "$event_id" '["Tier-A-1", "Tier-B-1", "Tier-C-1"]')"
tiered_request_success="$(json_field "$tiered_request_response" success)"
if [ "$tiered_request_success" != "true" ]; then
  log_error "tiered seat request failed: $tiered_request_response"
  exit 1
fi
tiered_total="$(json_field "$tiered_request_response" seat_request.total_amount)"
if [ "$tiered_total" != "60.00" ]; then
  log_error "expected tiered total_amount 60.00, got ${tiered_total}"
  exit 1
fi

log_step "[tiered-pricing] verifying admin update supports more than 3 tiers"
update_four_tiers_payload=$(cat <<JSON
{
  "pricing_config": {
    "mode": "tiered",
    "tiers": [
      { "id": "vip", "label": "VIP", "price": 30.00, "note": "Closest seats", "color": "#F59E0B" },
      { "id": "premium", "label": "Premium", "price": 20.00, "note": "Center floor", "color": "#06B6D4" },
      { "id": "standard", "label": "Standard", "price": 10.00, "note": "Rear tables", "color": "#10B981" },
      { "id": "balcony", "label": "Balcony", "price": 45.00, "note": "Future expansion tier", "color": "#8B5CF6" }
    ],
    "assignments": {
      "id:tier-row-a": "vip",
      "id:tier-row-b": "premium",
      "id:tier-row-c": "standard"
    }
  }
}
JSON
)
update_response="$(admin_post_json "PUT" "/events/${event_id}" "$update_four_tiers_payload")"
update_success="$(json_field "$update_response" success)"
if [ "$update_success" != "true" ]; then
  log_error "failed to update tiered event to four tiers: $update_response"
  exit 1
fi

event_after_update="$(fetch_event "$event_id")"
tier_count_after_update="$(EVENT_JSON="$event_after_update" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ.get('EVENT_JSON', '{}'))
tiers = (((payload.get('event') or {}).get('pricing_config') or {}).get('tiers') or [])
print(len(tiers))
PY
)"
if [ "$tier_count_after_update" != "4" ]; then
  log_error "expected 4 pricing tiers after update, got ${tier_count_after_update}"
  exit 1
fi
updated_max="$(json_field "$event_after_update" event.max_ticket_price)"
if [ "$updated_max" != "45.00" ]; then
  log_error "expected max_ticket_price 45.00 after four-tier update, got ${updated_max}"
  exit 1
fi

log_step "[tiered-pricing] verifying admin can switch back to flat pricing without regressions"
switch_to_flat_payload=$(cat <<JSON
{
  "pricing_config": null,
  "ticket_price": 18.00,
  "door_price": 20.00,
  "min_ticket_price": 18.00,
  "max_ticket_price": 20.00
}
JSON
)
switch_response="$(admin_post_json "PUT" "/events/${event_id}" "$switch_to_flat_payload")"
switch_success="$(json_field "$switch_response" success)"
if [ "$switch_success" != "true" ]; then
  log_error "failed to switch tiered event back to flat pricing: $switch_response"
  exit 1
fi

flat_event_response="$(fetch_event "$event_id")"
flat_pricing_config="$(json_field "$flat_event_response" event.pricing_config)"
flat_ticket_price="$(json_field "$flat_event_response" event.ticket_price)"
if [ "$flat_pricing_config" != "null" ]; then
  log_error "expected pricing_config to be null after switching back to flat pricing"
  exit 1
fi
if [ "$flat_ticket_price" != "18.00" ]; then
  log_error "expected ticket_price 18.00 after switching back to flat pricing, got ${flat_ticket_price}"
  exit 1
fi

flat_request_response="$(submit_request "$event_id" '["Tier-A-2", "Tier-B-2"]')"
flat_request_success="$(json_field "$flat_request_response" success)"
if [ "$flat_request_success" != "true" ]; then
  log_error "flat seat request after switching modes failed: $flat_request_response"
  exit 1
fi
flat_total="$(json_field "$flat_request_response" seat_request.total_amount)"
if [ "$flat_total" != "36.00" ]; then
  log_error "expected flat total_amount 36.00 after switching modes, got ${flat_total}"
  exit 1
fi

log_success "[tiered-pricing] create/update/display scaffolding verified"
