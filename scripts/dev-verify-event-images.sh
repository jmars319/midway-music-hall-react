#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-event-images.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"
created_event_id=""
created_media_id=""
tmp_image="${TMP_DIR}/event-image.png"
manifest_dir="${MMH_VERIFY_IMAGE_MANIFEST_DIR:-${ROOT_DIR}/storage/image-manifests}"
public_manifest_dir="${ROOT_DIR}/backend/uploads/manifests"

cleanup() {
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
    created_event_id=""
  fi
  if [ -n "$created_media_id" ]; then
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/media/${created_media_id}" >/dev/null 2>&1 || true
    created_media_id=""
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

# Generate a tiny 1x1 PNG for upload
base64 -d >"$tmp_image" <<'PNG'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=
PNG

post_json() {
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
    log_error "admin login failed in event-images verify script"
    exit 1
  fi
}

admin_login

private_manifest_count_before="$(find "$manifest_dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
public_manifest_count_before="$(find "$public_manifest_dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"

json_field() {
  local json="$1"
  local field="$2"
  printf '%s' "$json" | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
except Exception as exc:
    raise SystemExit(f"invalid json: {exc}")
value = data.get(sys.argv[1])
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value if value is not None else "")' "$field"
}

log_step "[event-images] uploading test media"
upload_response=$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  -F "file=@${tmp_image}" \
  -F 'category=gallery' \
  "${API_BASE}/media")
created_media_id=$(python3 -c 'import json,sys
payload=json.load(sys.stdin)
media=payload.get("media") or {}
mid=media.get("id")
if not mid:
    raise SystemExit("missing media id")
print(int(mid))' <<<"$upload_response")
media_file_url=$(python3 -c 'import json,sys
payload=json.load(sys.stdin)
media=payload.get("media") or {}
url=media.get("file_url") or media.get("optimized_path")
if not url:
    raise SystemExit("missing media url")
print(url)' <<<"$upload_response")

log_step "[event-images] verifying manifests are written to private storage"
private_manifest_count_after="$(find "$manifest_dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
public_manifest_count_after="$(find "$public_manifest_dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$private_manifest_count_after" -le "$private_manifest_count_before" ]; then
  log_error "[event-images] expected a new manifest in private storage after upload"
  exit 1
fi
if [ "$public_manifest_count_after" -ne "$public_manifest_count_before" ]; then
  log_error "[event-images] manifest count changed in public uploads/manifests"
  exit 1
fi

event_date="$(date -u +%F)"
door_time="${event_date} 18:00:00"
create_payload=$(cat <<JSON
{
  "artist_name": "Verify Event Images",
  "title": "Verify Event Images",
  "event_date": "${event_date}",
  "event_time": "20:00:00",
  "door_time": "${door_time}",
  "timezone": "America/New_York",
  "status": "draft",
  "visibility": "private",
  "ticket_type": "general_admission",
  "seating_enabled": false,
  "poster_image_id": ${created_media_id}
}
JSON
)
create_response=$(post_json "POST" "/events" "$create_payload")
created_event_id=$(json_field "$create_response" id)

assert_effective_source() {
  local json="$1"
  local expected="$2"
  JSON_PAYLOAD="$json" python3 - "$expected" <<'PY'
import json, os, sys
expected = sys.argv[1]
payload = os.environ.get('JSON_PAYLOAD') or ''
data = json.loads(payload)
event = data.get('event') or {}
eff = event.get('effective_image') or {}
source = eff.get('source')
poster_id = event.get('poster_image_id')
if expected == 'poster_media':
    if poster_id in (None, '', 0):
        raise SystemExit('poster_image_id missing after upload')
    if source != 'poster_media':
        raise SystemExit(f"expected effective_image.source poster_media, got {source}")
else:
    if source == 'poster_media':
        raise SystemExit('expected fallback image but still seeing poster_media source')
PY
}

event_json=$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${created_event_id}")
assert_effective_source "$event_json" "poster_media"

log_step "[event-images] clearing poster reference"
clear_payload='{"poster_image_id": null, "hero_image_id": null, "image_url": ""}'
post_json "PUT" "/events/${created_event_id}" "$clear_payload" >/dev/null

event_json_cleared=$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${created_event_id}")
assert_effective_source "$event_json_cleared" "fallback"

log_success "[event-images] verification succeeded"
