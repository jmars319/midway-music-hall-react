#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

DEV_DIR="$ROOT_DIR/.dev"

printf "%-10s %-8s %s\n" SERVICE STATUS INFO
for svc in backend frontend; do
  pidfile="$DEV_DIR/${svc}.pid"
  pid_display="-"
  status="stopped"
  if [ -f "$pidfile" ]; then
    count=0
    alive=0
    while IFS= read -r line || [ -n "$line" ]; do
      trimmed="$(echo "$line" | tr -d '[:space:]')"
      [ -z "$trimmed" ] && continue
      count=$((count + 1))
      if [ "$pid_display" = "-" ]; then
        pid_display="$trimmed"
      fi
      if kill -0 "$trimmed" >/dev/null 2>&1; then
        alive=1
      fi
    done < "$pidfile"
    if [ "$count" -gt 1 ] && [ "$pid_display" != "-" ]; then
      pid_display="${pid_display}+$(($count - 1))"
    fi
    if [ "$count" -eq 0 ]; then
      status="stopped"
      pid_display="-"
    elif [ "$alive" -eq 1 ]; then
      status="running"
    else
      status="stale-pid"
    fi
  fi
  if [ "$svc" = "backend" ]; then
    port="$DEV_BACKEND_PORT"
  else
    port="$DEV_FRONTEND_PORT"
  fi
  listener="no"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1; then
      listener="yes"
    fi
  else
    if command -v curl >/dev/null 2>&1; then
      if curl -sS --max-time 1 "http://localhost:${port}/" >/dev/null 2>&1; then
        listener="yes"
      fi
    fi
  fi
  printf "%-10s %-8s %s listener=%s pid=%s\n" "$svc" "$status" "" "$listener" "$pid_display"
done
