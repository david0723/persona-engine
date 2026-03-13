#!/bin/bash
set -e

# Docker socket group setup (for orchestrator personas using DooD)
if [ -S /var/run/docker.sock ]; then
  DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
  if [ -n "$DOCKER_GID" ] && [ "$DOCKER_GID" != "0" ]; then
    groupadd -g "$DOCKER_GID" docker-host 2>/dev/null || true
    usermod -aG docker-host persona 2>/dev/null || true
  fi
fi

# Clone or update repo if configured (as persona user for correct ownership)
if [ -n "$PERSONA_ENGINE_REPO_URL" ]; then
  gosu persona bash -c "
    WORKSPACE=/home/persona/workspace
    REPO_DIR=\$WORKSPACE/persona-engine
    mkdir -p \$WORKSPACE

    if [ ! -d \"\$REPO_DIR/.git\" ]; then
      echo '[entrypoint] Cloning $PERSONA_ENGINE_REPO_URL...'
      git clone \"$PERSONA_ENGINE_REPO_URL\" \"\$REPO_DIR\"
    else
      echo '[entrypoint] Pulling latest changes...'
      cd \"\$REPO_DIR\"
      git pull --ff-only || echo '[entrypoint] Pull failed (non-fast-forward), continuing with existing code'
    fi

    cd \"\$REPO_DIR\"
    git config user.name 'persona-engine'
    git config user.email 'persona@engine'

    if [ -n \"$GITHUB_TOKEN\" ]; then
      git config credential.helper '!f() { echo \"username=x-access-token\"; echo \"password=$GITHUB_TOKEN\"; }; f'
    fi
  "
fi

exec gosu persona node /app/dist/index.js "$@"
