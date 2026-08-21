#!/bin/bash

# One-time (or manual) dependency bootstrap script.
# Usage:
#   ./bootstrap.sh         # normal bootstrap
#   ./bootstrap.sh --force # force reinstall frontend deps

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
FORCE_INSTALL_FRONTEND=false

if [ "${1:-}" = "--force" ]; then
  FORCE_INSTALL_FRONTEND=true
fi

echo "Bootstrapping Trade Journal Free dependencies..."

echo "[backend] setting up virtual environment"
cd "$SCRIPT_DIR/backend"
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo "[frontend] installing node dependencies"
cd "$SCRIPT_DIR/frontend"
if [ "$FORCE_INSTALL_FRONTEND" = true ] || [ ! -d "node_modules" ]; then
  npm install
else
  echo "node_modules exists, skipping npm install (use --force to reinstall)"
fi

echo "Bootstrap complete."
