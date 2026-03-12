#!/bin/bash
set -e

WORKSPACE="/home/persona/workspace"
REPO_DIR="$WORKSPACE/persona-engine"

# Clone or update repo if configured
if [ -n "$PERSONA_ENGINE_REPO_URL" ]; then
  mkdir -p "$WORKSPACE"

  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "[entrypoint] Cloning $PERSONA_ENGINE_REPO_URL..."
    git clone "$PERSONA_ENGINE_REPO_URL" "$REPO_DIR"
  else
    echo "[entrypoint] Pulling latest changes..."
    cd "$REPO_DIR"
    git pull --ff-only || echo "[entrypoint] Pull failed (non-fast-forward), continuing with existing code"
    cd /
  fi

  # Configure git identity
  cd "$REPO_DIR"
  git config user.name "persona-engine"
  git config user.email "persona@engine"

  # Configure GitHub auth via token if available
  if [ -n "$GITHUB_TOKEN" ]; then
    git config credential.helper '!f() { echo "username=x-access-token"; echo "password=$GITHUB_TOKEN"; }; f'
  fi

  cd /
fi

exec node /app/dist/index.js "$@"
