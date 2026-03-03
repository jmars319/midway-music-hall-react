#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-login-identifiers.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

VERIFY_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-}"
VERIFY_USERNAME="${MMH_VERIFY_LOGIN_USERNAME:-admin}"
VERIFY_EMAIL="${MMH_VERIFY_LOGIN_EMAIL:-admin@midwaymusichall.net}"

if [ -z "$VERIFY_PASSWORD" ]; then
  log_error "set MMH_VERIFY_LOGIN_PASSWORD before running this script"
  log_info "example: MMH_VERIFY_LOGIN_PASSWORD='your-password' bash ./scripts/dev-verify-login-identifiers.sh"
  exit 1
fi

attempt_login() {
  local identifier="$1"
  local label="$2"
  local cookie_file="$TMP_DIR/cookies-${label}.txt"
  local body_file="$TMP_DIR/body-${label}.json"

  local payload
  payload=$(python3 - "$identifier" "$VERIFY_PASSWORD" <<'PY'
import json
import sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))
PY
)

  local http_code
  http_code=$(curl -sS -o "$body_file" -w "%{http_code}" \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -c "$cookie_file" \
    -d "$payload" \
    "${API_BASE}/login")

  local success
  success=$(python3 - "$body_file" <<'PY'
import json
import sys
path = sys.argv[1]
try:
    with open(path, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
except Exception:
    print('0')
    raise SystemExit(0)
print('1' if data.get('success') else '0')
PY
)

  local message
  message=$(python3 - "$body_file" <<'PY'
import json
import sys
path = sys.argv[1]
try:
    with open(path, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
except Exception:
    print('unparseable response')
    raise SystemExit(0)
print(str(data.get('message') or '').strip())
PY
)

  printf '%s|%s|%s\n' "$http_code" "$success" "$message"
}

log_step "[login-identifiers] testing email login"
email_result=$(attempt_login "$VERIFY_EMAIL" "email")
email_code="${email_result%%|*}"
email_rest="${email_result#*|}"
email_success="${email_rest%%|*}"
email_message="${email_rest#*|}"

if [ "$email_success" != "1" ]; then
  log_error "email login failed (http ${email_code}). Verify MMH_VERIFY_LOGIN_EMAIL and MMH_VERIFY_LOGIN_PASSWORD. ${email_message}"
  exit 1
fi

log_success "[login-identifiers] email login succeeded"

log_step "[login-identifiers] testing username login"
username_result=$(attempt_login "$VERIFY_USERNAME" "username")
username_code="${username_result%%|*}"
username_rest="${username_result#*|}"
username_success="${username_rest%%|*}"
username_message="${username_rest#*|}"

if [ "$username_success" != "1" ]; then
  log_error "username login failed (http ${username_code}) while email login succeeded. Username auth may be unsupported or regressed. ${username_message}"
  exit 1
fi

log_success "[login-identifiers] username login succeeded"
log_success "[login-identifiers] verification complete (email + username accepted)"
