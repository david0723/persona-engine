FROM node:20-slim

# Install common CLI tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install opencode
RUN curl -fsSL https://opencode.ai/install | bash

# Copy application
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ dist/

# Create non-root user and set up opencode for it
RUN useradd -m -s /bin/bash persona && \
    cp -r /root/.opencode /home/persona/.opencode && \
    chown -R persona:persona /home/persona /app

USER persona

# Persona data persisted via volume
VOLUME /home/persona/.persona-engine

EXPOSE 3100

ENTRYPOINT ["node", "/app/dist/index.js"]
