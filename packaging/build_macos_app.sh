#!/bin/bash

# Build a local-only macOS app bundle. Run this on the macOS CPU architecture
# you intend to distribute for (Apple Silicon or Intel).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
PYTHON_BIN="$PROJECT_DIR/backend/venv/bin/python"
RELEASE_DIR="${TRADE_JOURNAL_RELEASE_DIR:-$PROJECT_DIR/macOS}"
export PYINSTALLER_CONFIG_DIR="${PYINSTALLER_CONFIG_DIR:-$PROJECT_DIR/.pyinstaller}"

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
rm -rf build dist "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

"$PYTHON_BIN" -m PyInstaller \
    --noconfirm \
    --clean \
    --windowed \
    --onedir \
    --name "Trade Journal" \
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

mv "dist/Trade Journal.app" "$RELEASE_DIR/Trade Journal.app"
rm -rf dist build

DOCS_DIR="$RELEASE_DIR/docs"
mkdir -p "$DOCS_DIR"
cp "$SCRIPT_DIR/docs/API-CONNECTION-KO.md" "$DOCS_DIR/"
cp "$SCRIPT_DIR/docs/API-CONNECTION-EN.md" "$DOCS_DIR/"

cd "$RELEASE_DIR"
PACKAGE_DIR="$RELEASE_DIR/Trade Journal Package"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"
mv "$RELEASE_DIR/Trade Journal.app" "$PACKAGE_DIR/"
mv "$DOCS_DIR" "$PACKAGE_DIR/"
ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "Trade-Journal-macOS.zip"
rm -rf "$PACKAGE_DIR"
echo "Created: $RELEASE_DIR/Trade-Journal-macOS.zip"
