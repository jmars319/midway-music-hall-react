#!/usr/bin/env bash

# Shared helpers for dev scripts. Expect ROOT_DIR to be set by caller before sourcing.
if [ -z "${ROOT_DIR:-}" ]; then
  echo "dev-common: ROOT_DIR must be set before sourcing" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/script-utils.sh"

DEV_DIR="${DEV_DIR:-$ROOT_DIR/.dev}"
mkdir -p "$DEV_DIR"

DEV_CONFIG_FILE="${DEV_CONFIG_FILE:-$DEV_DIR/dev-config.sh}"
if [ -f "$DEV_CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  . "$DEV_CONFIG_FILE"
fi

DEV_BACKEND_HOST="${DEV_BACKEND_HOST:-localhost}"
DEV_FRONTEND_HOST="${DEV_FRONTEND_HOST:-localhost}"
DEV_BACKEND_PORT="${DEV_BACKEND_PORT:-8080}"
DEV_FRONTEND_PORT="${DEV_FRONTEND_PORT:-3000}"
DEV_BACKEND_HEALTH_PATH="${DEV_BACKEND_HEALTH_PATH:-/api/health}"
DEV_BACKEND_ROOT="${DEV_BACKEND_ROOT:-backend}"
DEV_FRONTEND_DIR="${DEV_FRONTEND_DIR:-frontend}"
DEV_BACKEND_HEALTH_TIMEOUT="${DEV_BACKEND_HEALTH_TIMEOUT:-15}"
DEV_FRONTEND_READY_TIMEOUT="${DEV_FRONTEND_READY_TIMEOUT:-30}"
DEV_PROXY_CHECK="${DEV_PROXY_CHECK:-1}"

backend_url() {
  echo "http://${DEV_BACKEND_HOST}:${DEV_BACKEND_PORT}"
}

frontend_url() {
  echo "http://${DEV_FRONTEND_HOST}:${DEV_FRONTEND_PORT}"
}

backend_health_url() {
  echo "$(backend_url)${DEV_BACKEND_HEALTH_PATH}"
}

frontend_proxy_health_url() {
  echo "$(frontend_url)${DEV_BACKEND_HEALTH_PATH}"
}

log_backend_config() {
  log_info "[dev-backend] host=$(backend_url) root=${DEV_BACKEND_ROOT} health=${DEV_BACKEND_HEALTH_PATH}"
}

log_frontend_config() {
  log_info "[dev-frontend] host=$(frontend_url) dir=${DEV_FRONTEND_DIR} proxy=http://localhost:${DEV_BACKEND_PORT}"
}

pids_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' '
  fi
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -t -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  if command -v nc >/dev/null 2>&1; then
    if nc -z localhost "$port" >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  if command -v curl >/dev/null 2>&1; then
    if curl -sS --max-time 1 "http://localhost:${port}/" >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  if { exec 3<>"/dev/tcp/127.0.0.1/${port}"; } 2>/dev/null; then
    exec 3>&-
    exec 3<&-
    return 0
  fi
  return 1
}

collect_pids_from_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo ""
    return
  fi
  local result=""
  while IFS= read -r line || [ -n "$line" ]; do
    local trimmed
    trimmed="$(echo "$line" | tr -d '[:space:]')"
    [ -z "$trimmed" ] && continue
    result="$result $trimmed"
  done < "$file"
  echo "$result"
}

write_pid_file() {
  local primary_pid="$1"
  local port="$2"
  local file="$3"
  local entries="$primary_pid"

  if command -v lsof >/dev/null 2>&1; then
    local listener_pids
    listener_pids=$(pids_on_port "$port")
    for listener in $listener_pids; do
      [ -z "$listener" ] && continue
      case " $entries " in
        *" $listener "*) ;;
        *) entries="$entries $listener" ;;
      esac
    done
  fi

  : > "$file"
  for entry in $entries; do
    printf "%s\n" "$entry" >> "$file"
  done
}

ensure_proxy_matches() {
  if [ "$DEV_PROXY_CHECK" -ne 1 ]; then
    return 0
  fi
  local package_json="$ROOT_DIR/$DEV_FRONTEND_DIR/package.json"
  local expected="http://localhost:${DEV_BACKEND_PORT}"
  if [ ! -f "$package_json" ]; then
    log_error "Cannot find ${package_json} to verify CRA proxy."
    exit 3
  fi
  if ! command -v node >/dev/null 2>&1; then
    log_error "node is required to verify CRA proxy configuration."
    exit 3
  fi
  local proxy_value
  proxy_value=$(node - "$package_json" <<'NODE'
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
try {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  process.stdout.write(pkg.proxy || '');
} catch (err) {
  process.stdout.write('');
}
NODE
)
  if [ -z "$proxy_value" ]; then
    log_error "CRA proxy missing in ${package_json}. Expected ${expected}. Fix proxy or set DEV_BACKEND_PORT."
    exit 3
  fi
  if [ "$proxy_value" != "$expected" ]; then
    log_error "CRA proxy mismatch (${proxy_value} != ${expected}). Update ${package_json} or DEV_BACKEND_PORT."
    exit 3
  fi
}

ensure_relative_api_config() {
  local api_config="$ROOT_DIR/$DEV_FRONTEND_DIR/src/apiConfig.js"
  if [ ! -f "$api_config" ]; then
    log_error "Cannot find ${api_config} to verify API configuration."
    exit 3
  fi
  if ! grep -q "return '/api';" "$api_config"; then
    log_error "frontend/src/apiConfig.js does not appear to return '/api' as the default; update it to keep dev proxy working."
    exit 3
  fi
}

wait_for_backend_ready() {
  local attempts=$DEV_BACKEND_HEALTH_TIMEOUT
  local url
  url="$(backend_health_url)"
  local attempt response
  for attempt in $(seq 1 "$attempts"); do
    response=$(curl -fsS --max-time 2 -H 'Accept: application/json' "$url" 2>/dev/null || true)
    if [ -n "$response" ] && [[ "$response" == \{* || "$response" == \[* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_frontend_ready() {
  local attempts=$DEV_FRONTEND_READY_TIMEOUT
  local url
  url="$(frontend_url)/"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

verify_proxy_chain() {
  local url
  url="$(frontend_proxy_health_url)"
  if ! curl -fsS --max-time 3 -H 'Accept: application/json' "$url" >/dev/null 2>&1; then
    log_error "frontend proxy check failed via ${url}. Ensure CRA proxy and backend are running."
    return 1
  fi
  return 0
}

require_backend_health_once() {
  if ! curl -fsS --max-time 3 -H 'Accept: application/json' "$(backend_health_url)" >/dev/null 2>&1; then
    log_error "Backend health check failed at $(backend_health_url)"
    return 1
  fi
  return 0
}

require_frontend_home_once() {
  if ! curl -fsS --max-time 3 "$(frontend_url)/" >/dev/null 2>&1; then
    log_error "Frontend check failed at $(frontend_url)/"
    return 1
  fi
  return 0
}

require_proxy_health_once() {
  if ! curl -fsS --max-time 3 -H 'Accept: application/json' "$(frontend_proxy_health_url)" >/dev/null 2>&1; then
    log_error "Proxy check failed at $(frontend_proxy_health_url)"
    return 1
  fi
  return 0
}
