# The Self-Evolving Architect

A guide to deploying a persona that understands its own codebase, improves itself based on your feedback, and restarts itself after pushing changes. You talk to it on Telegram, SSH in to attach to the live session, and it commits directly to main.

## What you're building

By the end of this guide you'll have:

- A persona running in Docker on your VPS
- Connected to Telegram so you can chat from your phone
- With full access to the persona-engine source code inside the container
- Able to read, edit, commit, and push code changes
- A host-side supervisor that rebuilds the container when the persona pushes a change
- SSH access to attach to the live conversation any time

The loop looks like this:

```
You (Telegram): "Add a /status command that shows uptime"
  |
  v
Architect reads the codebase, plans the change, implements it
  |
  v
Architect runs `npm run build`, commits, pushes to main
  |
  v
Architect writes a restart signal
  |
  v
Supervisor detects signal, pulls code, rebuilds container
  |
  v
Persona comes back up with the new code
  |
  v
You: "/status" -> works
```

## Prerequisites

On your VPS:

- Docker and Docker Compose
- Git
- Node.js 20+ (for building persona-engine)
- A domain pointing at your VPS (for the Telegram webhook)
- A reverse proxy (nginx, caddy, etc.) forwarding HTTPS traffic to port 3100

On your side:

- A GitHub personal access token with repo push access
- A Telegram bot token (from @BotFather)
- Your Telegram chat ID (from @userinfobot)
- An LLM API key (Gemini, Anthropic, OpenAI, etc.)

## Step 1: Install persona-engine on the VPS

SSH into your server and clone the repo:

```bash
cd /opt
git clone https://github.com/david0723/persona-engine.git
cd persona-engine
npm install
npm run build
npm link
```

Set up your API keys. You can either export them or put them in `~/.persona-engine/.env`:

```bash
mkdir -p ~/.persona-engine
cat > ~/.persona-engine/.env << 'EOF'
GEMINI_API_KEY=your-key-here
GITHUB_TOKEN=ghp_your-token-here
EOF
```

## Step 2: Create the architect persona

```bash
persona create architect --template architect
```

This generates `~/.persona-engine/personas/architect/persona.yaml` with the architect template pre-filled. Open it:

```bash
nano ~/.persona-engine/personas/architect/persona.yaml
```

Fill in the three things that need your input:

```yaml
# 1. Your repo URL (the template defaults to the upstream repo)
self_update:
  enabled: true
  repo_url: "https://github.com/YOUR-USER/persona-engine.git"
  branch: "main"

# 2. Your Telegram bot
telegram:
  enabled: true
  bot_token: "123456789:ABCdefGHIjklMNO..."
  allowed_chat_ids: [123456789]

# 3. Your API key in the allowed_env list
container:
  enabled: true
  network: bridge
  memory_limit: "1g"
  cpu_limit: "2.0"
  allowed_env:
    - GEMINI_API_KEY    # or ANTHROPIC_API_KEY, etc.
    - GITHUB_TOKEN
    - PERSONA_ENGINE_REPO_URL
```

Everything else in the template is ready to go. The identity, backstory, instructions, permissions, and heartbeat are all configured for the architect use case.

## Step 3: Set up your reverse proxy

The Telegram webhook needs HTTPS. Here's a minimal nginx config:

```nginx
server {
    listen 443 ssl;
    server_name persona.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/persona.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/persona.your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Or with Caddy (auto-HTTPS):

```
persona.your-domain.com {
    reverse_proxy 127.0.0.1:3100
}
```

## Step 4: Deploy

```bash
export GITHUB_TOKEN="ghp_your-token-here"
export GEMINI_API_KEY="your-key-here"

persona start architect -d
```

This does three things:

1. Generates `docker-compose.architect.yml` with the right volumes, env vars, and security settings
2. Builds the Docker image and starts the container
3. Prints instructions for setting up the supervisor

The container starts, runs `entrypoint.sh`, which clones your repo into `/home/persona/workspace/persona-engine`, configures git auth, and launches the persona in Telegram-only mode.

## Step 5: Set up the supervisor

The supervisor is a simple shell script that runs on the host (outside Docker). It polls for a restart signal file and rebuilds the container when it finds one.

Copy the systemd service file:

```bash
sudo cp /opt/persona-engine/supervisor/persona-supervisor.service /etc/systemd/system/
```

Edit it to match your paths:

```bash
sudo systemctl edit persona-supervisor --full
```

The key environment variables:

```ini
[Service]
Environment=PROJECT_DIR=/opt/persona-engine
Environment=COMPOSE_FILE=/opt/persona-engine/docker-compose.architect.yml
Environment=SIGNAL_DIR=/var/lib/docker/volumes/persona-data/_data/signals
Environment=POLL_INTERVAL=5
```

To find the exact volume path for `SIGNAL_DIR`:

```bash
docker volume inspect persona-data --format '{{ .Mountpoint }}'
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable persona-supervisor
sudo systemctl start persona-supervisor
```

Verify it's running:

```bash
sudo systemctl status persona-supervisor
journalctl -u persona-supervisor -f
```

## Step 6: Test it

Open Telegram and message your bot:

```
You: Hey, are you there?
```

The architect should respond. It knows who it is and what it can do.

Now ask it to do something with the codebase:

```
You: Can you read src/index.ts and tell me what commands are registered?
```

It should read the file and list the commands. If it can do that, the repo clone worked and bash/read permissions are active.

Now test the full loop:

```
You: Add a comment at the top of src/index.ts that says "// Architect was here"
```

Watch it:
1. Read the file
2. Make the edit
3. Run `npm run build`
4. Commit and push
5. (Optionally) trigger a restart if you ask it to

## Step 7: Attach from SSH

From any SSH session on the VPS:

```bash
persona attach architect
```

You'll see the recent conversation history and can observe everything in real time. Messages from Telegram show up tagged with `[telegram]`. You can type messages too, and they go through the engine just like Telegram messages do.

This is useful for:

- Watching the architect work on something complex
- Sending follow-up instructions that are too long for Telegram
- Debugging when something goes wrong
- Pasting code snippets or error logs

Press Ctrl+C to detach. The persona keeps running.

## How the restart cycle works

When the architect pushes a code change that affects runtime behavior, it can trigger a self-restart:

1. The persona calls `requestRestart("Updated X feature")` inside the container
2. This writes a JSON signal file to `~/.persona-engine/signals/restart.json`
3. The signal includes the commit SHA, a reason, and a timestamp
4. The persona sends you a Telegram message: "Restarting to apply changes: Updated X feature"
5. The host-side supervisor detects the signal file (polling every 5 seconds)
6. The supervisor runs `git pull && docker compose up -d --build` on the host
7. The old container stops, a new one starts with the updated code
8. The new container clones the latest repo state on startup
9. The persona is back online with the changes applied

The full git history is preserved. If something goes wrong, you can always `git revert` or `git reset` and redeploy.

## The signal file format

```json
{
  "action": "restart",
  "commit": "abc123f",
  "reason": "Added /status command",
  "timestamp": "2026-03-12T14:30:00.000Z"
}
```

The supervisor reads this, logs the metadata, rebuilds, and deletes the file.

## What the architect persona knows

The architect template (`personas/architect.yaml`) gives the persona:

**Identity**: It knows it's the architect of persona-engine. It speaks technically but clearly.

**Values**: Incremental changes over rewrites. Every change gets a commit. Ask before making big decisions. Keep the code simple.

**Instructions**: It knows where the code lives (`/home/persona/workspace/persona-engine`). It knows to read `.agents.md` for git rules. It follows a specific workflow: read the code, explain the plan, implement, build, commit, push, restart if needed.

**Heartbeat activities** (every 6 hours): Review recent commits, look for TODOs, think about improvements, journal about its understanding of the architecture.

**Permissions**: Full bash, edit, and read access inside the container. Network access (bridge mode) for git push and Telegram.

## Customizing the architect

The template is a starting point. Some things you might want to change:

**Repo URL**: Update `self_update.repo_url` if you forked the repo.

**Heartbeat interval**: The default is 360 minutes (6 hours). Lower it if you want more frequent autonomous thinking, raise it to save API costs.

**Heartbeat activities**: Add project-specific activities like "Check if the latest deploy is healthy" or "Review open GitHub issues".

**MCP servers**: Give the architect access to tools. For example, Brave Search for looking up documentation:

```yaml
mcp_servers:
  "Brave Search":
    type: local
    command: ["npx", "-y", "@modelcontextprotocol/server-brave-search"]
    environment:
      BRAVE_API_KEY: "your-key"
```

**Resource limits**: The default is 1GB memory and 2 CPUs. Adjust based on your VPS.

**Instructions**: Add project-specific rules. If you want the architect to follow a particular code style, run specific tests, or avoid certain patterns, add them to the instructions block.

## Troubleshooting

### The persona can't push to GitHub

Check that `GITHUB_TOKEN` is set and has repo push access:

```bash
# Inside the container
docker exec -it persona-architect-1 bash
cd /home/persona/workspace/persona-engine
git push --dry-run
```

If the token is a fine-grained PAT, make sure it has "Contents: Read and write" permission on the repo.

### The supervisor doesn't detect restarts

Check the signal directory path. The supervisor needs to read from the Docker volume mount on the host:

```bash
docker volume inspect persona-data --format '{{ .Mountpoint }}'
# Should output something like /var/lib/docker/volumes/persona-data/_data

ls /var/lib/docker/volumes/persona-data/_data/signals/
```

Check supervisor logs:

```bash
journalctl -u persona-supervisor -f
```

### The container can't clone the repo

Make sure `PERSONA_ENGINE_REPO_URL` is being passed through. Check the generated compose file:

```bash
cat /opt/persona-engine/docker-compose.architect.yml | grep PERSONA_ENGINE_REPO_URL
```

### The persona lost context after restart

This is expected. The opencode session doesn't persist across container restarts. But the persona's memories do (stored in SQLite on the persona-data volume). After restart, the persona rebuilds its context from memories on the first message.

### Attach says "no running instance found"

The IPC socket lives at `~/.persona-engine/personas/architect/engine.sock`. If the container is running but you can't attach, it might be because you're looking at the host's `~/.persona-engine` instead of the container's volume.

For containerized personas, attach only works from inside the container or if you mount the socket path. An alternative: use `docker exec -it <container> bash` and run `persona attach architect` from inside.

## Security notes

The architect has significant power inside its container:

- Full bash access (can run any command)
- Network access (can reach the internet)
- Git push access to your repo (via GITHUB_TOKEN)
- Can modify its own source code

The safety boundaries:

- **Container isolation**: It can't access the host filesystem, other containers, or anything outside its cage
- **Read-only root**: The container filesystem is read-only except for `/tmp` and the mounted volumes
- **Token scope**: The GitHub token should be scoped to only the repos you want the architect to touch
- **Chat ID restriction**: Only your Telegram account can talk to it
- **Git history**: Every change is a commit on main. Full audit trail. Easy to revert.
- **Supervisor is host-side**: The persona can request a restart, but the supervisor (running on the host) decides whether to act on it

The architect commits directly to main. This is intentional for the self-evolving use case. If you want a PR-based workflow instead, modify the instructions to tell the architect to create branches and open PRs instead of pushing to main.
