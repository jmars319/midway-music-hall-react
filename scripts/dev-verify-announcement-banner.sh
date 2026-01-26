#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-banner-verify.XXXXXX")"

original_banner_b64=""
restore_needed=0

cleanup_resources() {
  if [ "$restore_needed" -eq 1 ]; then
    python3 - "$API_BASE" "$original_banner_b64" <<'PY'
import base64, json, sys, urllib.request
api_base = sys.argv[1]
raw_b64 = sys.argv[2]
raw_value = ''
if raw_b64:
  raw_value = base64.b64decode(raw_b64.encode()).decode()
payload = {'announcement_banner': raw_value}
body = json.dumps(payload).encode()
req = urllib.request.Request(f"{api_base}/settings", data=body, headers={'Content-Type': 'application/json'}, method='PUT')
try:
  urllib.request.urlopen(req).read()
except Exception as exc:  # pragma: no cover
  sys.stderr.write(f"[cleanup] Failed to restore announcement banner: {exc}\n")
PY
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup_resources EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

settings_response=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/settings")
settings_ok=$(printf '%s' "$settings_response" | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("0")
    raise SystemExit(0)
print("1" if data.get("success") else "0")
')
if [ "$settings_ok" != "1" ]; then
  log_error "settings endpoint failed; verify business_settings table exists and database/20251212_schema_upgrade.sql has been applied"
  exit 1
fi
original_banner_b64=$(printf '%s' "$settings_response" | python3 -c 'import base64, json, sys
data = json.load(sys.stdin)
settings = data.get("settings") or {}
value = settings.get("announcement_banner")
if value is None:
  print("")
else:
  print(base64.b64encode(str(value).encode()).decode())
')

banner_value=$(python3 - <<'PY'
import json
payload = {
  "enabled": True,
  "message": "Weather alert: opening delayed by 1 hour.",
  "label": "Weather Update",
  "link_url": "https://midwaymusichall.net",
  "link_text": "Check updates",
  "severity": "warning"
}
print(json.dumps(payload))
PY
)

banner_body=$(python3 - "$banner_value" <<'PY'
import json, sys
value = sys.argv[1]
print(json.dumps({"announcement_banner": value}))
PY
)

log_step "[banner] enabling announcement banner"
curl -fsS -X PUT -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "$banner_body" \
  "${API_BASE}/settings" >/dev/null
restore_needed=1

log_step "[banner] verifying banner present in site content"
site_response=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/site-content")
enabled_flag=$(printf '%s' "$site_response" | python3 -c 'import json, sys
data = json.load(sys.stdin)
banner = data.get("content", {}).get("announcement") or {}
print("1" if banner.get("enabled") else "0")
')
if [ "$enabled_flag" != "1" ]; then
  log_error "announcement banner not reported as enabled"
  exit 1
fi

log_step "[banner] disabling announcement banner"
disabled_value=$(python3 - <<'PY'
import json
payload = {
  "enabled": False,
  "message": "",
  "label": "",
  "link_url": "",
  "link_text": "",
  "severity": "info"
}
print(json.dumps(payload))
PY
)
disabled_body=$(python3 - "$disabled_value" <<'PY'
import json, sys
value = sys.argv[1]
print(json.dumps({"announcement_banner": value}))
PY
)
curl -fsS -X PUT -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "$disabled_body" \
  "${API_BASE}/settings" >/dev/null

log_step "[banner] verifying banner disabled in site content"
site_response=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/site-content")
enabled_flag=$(printf '%s' "$site_response" | python3 -c 'import json, sys
data = json.load(sys.stdin)
banner = data.get("content", {}).get("announcement") or {}
print("1" if banner.get("enabled") else "0")
')
if [ "$enabled_flag" != "0" ]; then
  log_error "announcement banner did not disable"
  exit 1
fi

log_success "[banner] announcement banner toggles correctly"
