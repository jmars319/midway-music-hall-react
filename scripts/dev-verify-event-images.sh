#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-event-images.XXXXXX")"
created_event_id=""
created_media_id=""
tmp_image="${TMP_DIR}/event-image.png"

cleanup() {
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
    created_event_id=""
  fi
  if [ -n "$created_media_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/media/${created_media_id}" >/dev/null 2>&1 || true
    created_media_id=""
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_backend_health_once || {
  echo "ERROR: backend is not running; start dev stack via scripts/dev-start.sh" >&2
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
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$body" \
    "${API_BASE}${path}"
}

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

echo "[event-images] uploading test media"
upload_response=$(curl -fsS -H 'Accept: application/json' -F "file=@${tmp_image}" -F 'category=gallery' "${API_BASE}/media")
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
url=media.get("optimized_path") or media.get("file_url")
if not url:
    raise SystemExit("missing media url")
print(url)' <<<"$upload_response")

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

event_json=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}")
assert_effective_source "$event_json" "poster_media"

echo "[event-images] clearing poster reference"
clear_payload='{"poster_image_id": null, "hero_image_id": null, "image_url": ""}'
post_json "PUT" "/events/${created_event_id}" "$clear_payload" >/dev/null

event_json_cleared=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}")
assert_effective_source "$event_json_cleared" "fallback"

echo "[event-images] verification succeeded"
