FROM node:20-slim

# Install common CLI tools + GitHub CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (for Docker-out-of-Docker orchestration)
RUN curl -fsSL https://download.docker.com/linux/debian/gpg \
       -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# Install gosu for entrypoint privilege drop
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*

# Install opencode
RUN curl -fsSL https://opencode.ai/install | bash

# Copy application
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ dist/
COPY entrypoint.sh /app/entrypoint.sh

# Create non-root user, workspace dir, and set up opencode
RUN useradd -m -s /bin/bash persona && \
    cp -r /root/.opencode /home/persona/.opencode && \
    mkdir -p /home/persona/workspace && \
    chown -R persona:persona /home/persona /app

# Note: USER is not set here - entrypoint runs as root for Docker socket
# group setup, then drops to persona via gosu

# Persona data persisted via volume
VOLUME /home/persona/.persona-engine

EXPOSE 3100

ENTRYPOINT ["/app/entrypoint.sh"]
