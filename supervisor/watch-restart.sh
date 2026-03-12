#!/bin/bash
# Supervisor script that watches for restart signals from the persona container.
# Runs on the host. Polls a signal file and rebuilds the container when triggered.
#
# Required env vars:
#   PROJECT_DIR       - Path to persona-engine repo on host
#   COMPOSE_FILE      - Path to the docker-compose.<name>.yml file
#   SIGNAL_DIR        - Path to the signals directory (inside the mounted volume)
#
# Optional:
#   POLL_INTERVAL     - Seconds between checks (default: 5)

set -e

POLL_INTERVAL="${POLL_INTERVAL:-5}"
SIGNAL_FILE="${SIGNAL_DIR}/restart.json"

echo "[supervisor] Watching for restart signals at: $SIGNAL_FILE"
echo "[supervisor] Project dir: $PROJECT_DIR"
echo "[supervisor] Compose file: $COMPOSE_FILE"
echo "[supervisor] Poll interval: ${POLL_INTERVAL}s"

while true; do
  if [ -f "$SIGNAL_FILE" ]; then
    echo "[supervisor] Restart signal detected!"

    # Read signal metadata
    COMMIT=$(jq -r '.commit // "unknown"' "$SIGNAL_FILE" 2>/dev/null || echo "unknown")
    REASON=$(jq -r '.reason // "no reason given"' "$SIGNAL_FILE" 2>/dev/null || echo "no reason given")
    TIMESTAMP=$(jq -r '.timestamp // "unknown"' "$SIGNAL_FILE" 2>/dev/null || echo "unknown")

    echo "[supervisor] Commit: $COMMIT"
    echo "[supervisor] Reason: $REASON"
    echo "[supervisor] Timestamp: $TIMESTAMP"

    # Pull latest code and rebuild
    echo "[supervisor] Pulling latest code..."
    cd "$PROJECT_DIR"
    git pull --ff-only || echo "[supervisor] Pull failed, continuing with rebuild"

    echo "[supervisor] Rebuilding container..."
    docker compose -f "$COMPOSE_FILE" up -d --build

    echo "[supervisor] Restart complete."

    # Remove signal file
    rm -f "$SIGNAL_FILE"
  fi

  sleep "$POLL_INTERVAL"
done
