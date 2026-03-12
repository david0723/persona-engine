FROM node:20-slim

# Install common CLI tools the persona might want to use
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
    tree \
    vim \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install opencode
RUN curl -fsSL https://opencode.ai/install | bash

# Create persona user (non-root)
RUN useradd -m -s /bin/bash persona
USER persona
WORKDIR /home/persona

# Data directory will be mounted from host
RUN mkdir -p /home/persona/data /home/persona/workspace

# Keep container running
CMD ["sleep", "infinity"]
