#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

"$ROOT_DIR/scripts/dev-frontend-stop.sh"
"$ROOT_DIR/scripts/dev-backend-stop.sh"

DEV_DIR="$ROOT_DIR/.dev"
ok=1
for f in "$DEV_DIR/frontend.pid" "$DEV_DIR/backend.pid"; do
	if [ -f "$f" ]; then
		echo "ERROR: $f still exists"
		ok=0
	fi
done

if command -v lsof >/dev/null 2>&1; then
	if lsof -nP -iTCP:${DEV_FRONTEND_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
		echo "ERROR: port ${DEV_FRONTEND_PORT} still listening"
		ok=0
	fi
	if lsof -nP -iTCP:${DEV_BACKEND_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
		echo "ERROR: port ${DEV_BACKEND_PORT} still listening"
		ok=0
	fi
fi

if [ "$ok" -eq 1 ]; then
	echo "dev servers stopped"
	exit 0
else
	exit 2
fi
