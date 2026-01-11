#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/backend.pid"
LOG_FILE="$DEV_DIR/backend.log"

if [ ! -f "$PID_FILE" ]; then
  log_info "not running"
  exit 0
fi

pid_list=()
while IFS= read -r line || [ -n "$line" ]; do
  trimmed="$(echo "$line" | tr -d '[:space:]')"
  [ -z "$trimmed" ] && continue
  pid_list+=("$trimmed")
done < "$PID_FILE"

if [ "${#pid_list[@]}" -eq 0 ]; then
  rm -f "$PID_FILE"
  log_info "not running"
  exit 0
fi

alive_found=0
for pid in "${pid_list[@]}"; do
  if kill -0 "$pid" >/dev/null 2>&1; then
    alive_found=1
    break
  fi
done

if [ "$alive_found" -eq 0 ]; then
  rm -f "$PID_FILE"
  log_info "not running"
  exit 0
fi

for pid in "${pid_list[@]}"; do
  kill "$pid" >/dev/null 2>&1 || true
done

if command -v pkill >/dev/null 2>&1; then
  for pid in "${pid_list[@]}"; do
    pkill -P "$pid" >/dev/null 2>&1 || true
  done
fi

for i in {1..8}; do
  remaining=0
  for pid in "${pid_list[@]}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      remaining=1
      break
    fi
  done
  if [ "$remaining" -eq 0 ]; then
    break
  fi
  sleep 1
done

for pid in "${pid_list[@]}"; do
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
done

rm -f "$PID_FILE"
log_success "stopped"
