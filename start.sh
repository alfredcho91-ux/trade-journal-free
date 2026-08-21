#!/bin/bash

# Backward-compatible launcher:
# - bootstraps dependencies only when missing
# - delegates runtime to dev.sh

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [ ! -d "$SCRIPT_DIR/backend/venv" ] || [ ! -d "$SCRIPT_DIR/frontend/node_modules" ]; then
  echo "Dependencies missing, running bootstrap first..."
  "$SCRIPT_DIR/bootstrap.sh"
fi

exec "$SCRIPT_DIR/dev.sh"
