#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEV_DIR="$ROOT_DIR/.dev"

printf "%-10s %-8s %s\n" SERVICE STATUS INFO
for svc in backend frontend; do
  pidfile="$DEV_DIR/${svc}.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" >/dev/null 2>&1; then
      status="running"
    else
      status="stale-pid"
    fi
  else
    pid="-"
    status="stopped"
  fi
  if [ "$svc" = "backend" ]; then
    port=8080
  else
    port=3000
  fi
  listener="no"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1; then
      listener="yes"
    fi
  else
    if command -v curl >/dev/null 2>&1; then
      if curl -sS --max-time 1 http://localhost:${port}/ >/dev/null 2>&1; then
        listener="yes"
      fi
    fi
  fi
  printf "%-10s %-8s %s listener=%s pid=%s\n" "$svc" "$status" "" "$listener" "$pid"
done
