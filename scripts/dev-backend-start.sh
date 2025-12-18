#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/backend.pid"
LOG_FILE="$DEV_DIR/backend.log"

log_backend_config

existing_pids=$(collect_pids_from_file "$PID_FILE")
if [ -n "$existing_pids" ]; then
  for existing in $existing_pids; do
    if kill -0 "$existing" >/dev/null 2>&1; then
      echo "[dev-backend] already running (pid $existing)"
      exit 0
    fi
  done
  rm -f "$PID_FILE"
fi

if port_in_use "$DEV_BACKEND_PORT"; then
  listeners=$(pids_on_port "$DEV_BACKEND_PORT")
  echo "ERROR: port ${DEV_BACKEND_PORT} already in use by PID(s): ${listeners:-unknown}."
  exit 2
fi

echo "[dev-backend] launching php -S ${DEV_BACKEND_HOST}:${DEV_BACKEND_PORT} -t ${DEV_BACKEND_ROOT}"
cd "$ROOT_DIR"
nohup php -S "${DEV_BACKEND_HOST}:${DEV_BACKEND_PORT}" -t "$DEV_BACKEND_ROOT" >"$LOG_FILE" 2>&1 &
pid=$!

if wait_for_backend_ready; then
  write_pid_file "$pid" "$DEV_BACKEND_PORT" "$PID_FILE"
  echo "[dev-backend] started (pid $pid)"
  exit 0
fi

if kill -0 "$pid" >/dev/null 2>&1; then
  kill "$pid" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
fi
echo "ERROR: backend failed to become ready at $(backend_health_url)"
exit 2
