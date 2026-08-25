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

JOURNAL_HOST="${JOURNAL_HOST:-127.0.0.1}"
JOURNAL_BACKEND_PORT="${JOURNAL_BACKEND_PORT:-8011}"
JOURNAL_FRONTEND_PORT="${JOURNAL_FRONTEND_PORT:-5181}"
if [ -z "${NODE_BIN:-}" ]; then
    NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -x "/Users/geunwoocho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ] && ! "$NODE_BIN" --version >/dev/null 2>&1; then
    NODE_BIN="/Users/geunwoocho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
    echo "Node.js was not found. Install Node.js or set NODE_BIN before starting Trade Journal."
    exit 1
fi

stop_existing_project_server() {
    local port="$1"
    local pid command
    while read -r pid; do
        [ -z "$pid" ] && continue
        command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
        case "$command" in
            *"$SCRIPT_DIR/frontend"*|*"$SCRIPT_DIR/backend"*|*"backend.main:app"*)
                echo "Stopping previous Trade Journal process $pid on port $port"
                kill "$pid" 2>/dev/null || true
                ;;
        esac
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
}

cleanup() {
    status=$?
    trap - EXIT SIGINT SIGTERM
    echo ""
    echo "Shutting down servers..."
    [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null || true
    [ -n "${FRONTEND_PID:-}" ] && kill "$FRONTEND_PID" 2>/dev/null || true
    stop_existing_project_server "$JOURNAL_BACKEND_PORT"
    stop_existing_project_server "$JOURNAL_FRONTEND_PORT"
    wait 2>/dev/null || true
    exit "$status"
}

trap cleanup EXIT SIGINT SIGTERM

echo -e "${BLUE}Starting Backend Server...${NC}"
cd "$SCRIPT_DIR"

stop_existing_project_server "$JOURNAL_BACKEND_PORT"
stop_existing_project_server "$JOURNAL_FRONTEND_PORT"

if [ ! -d "backend/venv" ]; then
    echo "Missing backend venv. Run ./bootstrap.sh first."
    exit 1
fi

"$SCRIPT_DIR/backend/venv/bin/python" -m uvicorn backend.main:app \
    --host "$JOURNAL_HOST" \
    --port "$JOURNAL_BACKEND_PORT" \
    --reload \
    --reload-dir backend \
    --reload-dir core &
BACKEND_PID=$!

sleep 2

if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend failed to start. Check whether port $JOURNAL_BACKEND_PORT is already in use."
    exit 1
fi

echo -e "${GREEN}Backend started on http://localhost:${JOURNAL_BACKEND_PORT}${NC}"
echo ""

echo -e "${BLUE}Starting Frontend Server...${NC}"
cd "$SCRIPT_DIR/frontend"

if [ ! -d "node_modules" ]; then
    echo "Missing frontend dependencies. Run ./bootstrap.sh first."
    exit 1
fi

VITE_API_TARGET="http://127.0.0.1:${JOURNAL_BACKEND_PORT}" \
    "$NODE_BIN" "$SCRIPT_DIR/frontend/node_modules/vite/bin/vite.js" --host "$JOURNAL_HOST" --port "$JOURNAL_FRONTEND_PORT" &
FRONTEND_PID=$!

sleep 1

if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend failed to start. Check whether port $JOURNAL_FRONTEND_PORT is already in use."
    exit 1
fi

echo -e "${GREEN}Frontend started on http://localhost:${JOURNAL_FRONTEND_PORT}${NC}"
echo ""

echo "Press Ctrl+C to stop all servers"

wait
