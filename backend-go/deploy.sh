#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="$SCRIPT_DIR/sinar-elektrik-backend"
PID_FILE="$SCRIPT_DIR/daemon.pid"
LOG_FILE="$SCRIPT_DIR/daemon.log"

cd "$SCRIPT_DIR"

# Stop existing daemon if running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing daemon (PID $OLD_PID)..."
    kill "$OLD_PID"
    # Wait up to 5 seconds for graceful shutdown
    for i in $(seq 1 10); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Build
echo "Building..."
CGO_ENABLED=1 go build -o "$BINARY" .
echo "Build OK → $BINARY"

# Start
echo "Starting daemon..."
nohup "$BINARY" >> "$LOG_FILE" 2>&1 &
DAEMON_PID=$!
echo "$DAEMON_PID" > "$PID_FILE"
echo "Daemon started (PID $DAEMON_PID) — logs: $LOG_FILE"

# Tail for 3 seconds to confirm startup
sleep 3
tail -5 "$LOG_FILE"
