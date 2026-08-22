#!/bin/bash

# Build a local-only macOS app bundle. Run this on the macOS CPU architecture
# you intend to distribute for (Apple Silicon or Intel).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
PYTHON_BIN="$PROJECT_DIR/backend/venv/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
    echo "Missing backend virtual environment. Run ./bootstrap.sh first."
    exit 1
fi

if [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
    echo "Missing frontend dependencies. Run ./bootstrap.sh first."
    exit 1
fi

if ! "$PYTHON_BIN" -m PyInstaller --version >/dev/null 2>&1; then
    echo "Missing PyInstaller. Install packaging requirements first:"
    echo "  $PYTHON_BIN -m pip install -r packaging/requirements-build.txt"
    exit 1
fi

cd "$PROJECT_DIR/frontend"
npm run build

cd "$PROJECT_DIR"
rm -rf build dist "release/Trade Journal Free.app"
mkdir -p release
rm -f "release/Trade-Journal-Free-macOS.zip"

"$PYTHON_BIN" -m PyInstaller \
    --noconfirm \
    --clean \
    --windowed \
    --onedir \
    --name "Trade Journal Free" \
    --paths "$PROJECT_DIR" \
    --add-data "$PROJECT_DIR/frontend/dist:frontend/dist" \
    --hidden-import ccxt.binance \
    --hidden-import ccxt.binanceusdm \
    --hidden-import ccxt.bybit \
    --hidden-import ccxt.okx \
    --hidden-import keyring.backends.macOS \
    --exclude-module pytest \
    --exclude-module _pytest \
    --collect-all diskcache \
    --collect-all cryptography \
    --collect-all orjson \
    --collect-all uvicorn \
    "$PROJECT_DIR/packaging/desktop_entry.py"

mv "dist/Trade Journal Free.app" "release/Trade Journal Free.app"
rm -rf dist build

cd release
ditto -c -k --sequesterRsrc --keepParent "Trade Journal Free.app" "Trade-Journal-Free-macOS.zip"
echo "Created: $PROJECT_DIR/release/Trade-Journal-Free-macOS.zip"
