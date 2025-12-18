#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Stop frontend first, then backend
"$ROOT_DIR/scripts/dev-frontend-stop.sh"
"$ROOT_DIR/scripts/dev-backend-stop.sh"

# verify both stopped: PID files removed and ports closed when possible
DEV_DIR="$ROOT_DIR/.dev"
ok=1
for f in "$DEV_DIR/frontend.pid" "$DEV_DIR/backend.pid"; do
	if [ -f "$f" ]; then
		echo "ERROR: $f still exists"
		ok=0
	fi


# check ports if lsof available
if command -v lsof >/dev/null 2>&1; then
	if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
		echo "ERROR: port 3000 still listening"
		ok=0
	fi
	if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
		echo "ERROR: port 8080 still listening"
		ok=0
	fi
fi

if [ "$ok" -eq 1 ]; then
	echo "dev servers stopped"
	exit 0
else
	exit 2
fi
