#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Stop frontend first, then backend
"$ROOT_DIR/scripts/dev-frontend-stop.sh"
"$ROOT_DIR/scripts/dev-backend-stop.sh"

echo "dev servers stopped"
