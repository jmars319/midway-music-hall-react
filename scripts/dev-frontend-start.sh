#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/frontend.pid"
LOG_FILE="$DEV_DIR/frontend.log"

ensure_proxy_matches
ensure_relative_api_config
log_frontend_config

existing_pids=$(collect_pids_from_file "$PID_FILE")
if [ -n "$existing_pids" ]; then
  for existing in $existing_pids; do
    if kill -0 "$existing" >/dev/null 2>&1; then
      echo "[dev-frontend] already running (pid $existing)"
      exit 0
    fi
  done
  rm -f "$PID_FILE"
fi

if port_in_use "$DEV_FRONTEND_PORT"; then
  listeners=$(pids_on_port "$DEV_FRONTEND_PORT")
  echo "ERROR: port ${DEV_FRONTEND_PORT} already in use by PID(s): ${listeners:-unknown}. Maybe another dev server is running."
  exit 2
fi

cd "$ROOT_DIR/$DEV_FRONTEND_DIR"
echo "[dev-frontend] launching npm start"
nohup npm start >"$LOG_FILE" 2>&1 &
pid=$!
sleep 0.5

if wait_for_frontend_ready && kill -0 "$pid" >/dev/null 2>&1; then
  write_pid_file "$pid" "$DEV_FRONTEND_PORT" "$PID_FILE"
  echo "[dev-frontend] started (pid $pid)"
  exit 0
fi

if kill -0 "$pid" >/dev/null 2>&1; then
  kill "$pid" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
fi
echo "ERROR: frontend failed to become ready at $(frontend_url)/"
exit 3
