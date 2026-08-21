#!/bin/bash

# Trade Journal Free - fast dev startup (no dependency install)

set -e

echo "Starting Trade Journal Free (dev mode)..."
echo ""

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
fi

cleanup() {
    echo ""
    echo "Shutting down servers..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

echo -e "${BLUE}Starting Backend Server...${NC}"
cd "$SCRIPT_DIR"

if [ ! -d "backend/venv" ]; then
    echo "Missing backend venv. Run ./bootstrap.sh first."
    exit 1
fi

"$SCRIPT_DIR/backend/venv/bin/python" -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --reload \
    --reload-dir backend \
    --reload-dir core &
BACKEND_PID=$!
echo -e "${GREEN}Backend started on http://localhost:8000${NC}"
echo ""

sleep 2

echo -e "${BLUE}Starting Frontend Server...${NC}"
cd "$SCRIPT_DIR/frontend"

if [ ! -d "node_modules" ]; then
    echo "Missing frontend dependencies. Run ./bootstrap.sh first."
    exit 1
fi

npm run dev &
FRONTEND_PID=$!
echo -e "${GREEN}Frontend started on http://localhost:5173${NC}"
echo ""

echo "Press Ctrl+C to stop all servers"

wait
