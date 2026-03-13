import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { stringify } from "yaml"
import { paths, loadPersonaEnv } from "../utils/config.js"
import type { PersonaDefinition } from "../persona/schema.js"

export interface ComposeOptions {
  name: string
  persona: PersonaDefinition
  port: number
  tunnelConfigDir?: string  // host path to tunnel config files
  webhookUrl?: string       // public URL for Telegram webhook registration
  detached?: boolean        // skip IPC socket setup hints
}

interface ComposeService {
  [key: string]: unknown
}

const PROJECT_DIR = join(import.meta.dirname, "..", "..")

/**
 * Generate a docker-compose YAML file for a persona stack.
 *
 * Services:
 *   - engine: runs the persona server (webhook + engine + IPC)
 *   - tunnel: (optional) cloudflare/cloudflared for public ingress
 *
 * Returns the path to the generated compose file.
 */
export function generateComposeFile(opts: ComposeOptions): string {
  const { name, persona, port, tunnelConfigDir, webhookUrl } = opts
  const personaDir = paths.personaDir(name)

  // Build environment variables
  const personaEnv = loadPersonaEnv(name)
  const environment: string[] = [
    "PERSONA_ENGINE_CONTAINERIZED=true",
  ]

  if (webhookUrl) {
    environment.push(`WEBHOOK_URL=${webhookUrl}`)
  }

  // Inject all vars from persona's .env
  for (const [key, value] of Object.entries(personaEnv)) {
    environment.push(`${key}=${value}`)
  }

  // Inject repo URL from self_update config if not already in .env
  const selfUpdate = persona.self_update
  if (selfUpdate?.enabled && selfUpdate.repo_url && !personaEnv.PERSONA_ENGINE_REPO_URL) {
    environment.push(`PERSONA_ENGINE_REPO_URL=${selfUpdate.repo_url}`)
  }

  const containerConfig = persona.container ?? { enabled: false }
  const memoryLimit = containerConfig.memory_limit ?? "512M"
  const cpuLimit = containerConfig.cpu_limit ?? "1.0"

  // Engine service
  const engine: ComposeService = {
    build: PROJECT_DIR,
    command: ["start", name, "--no-cli", "--port", String(port)],
    volumes: [
      // Bind-mount persona data dir for IPC socket + memory DB access
      `${personaDir}:/home/persona/.persona-engine/personas/${name}`,
      ...(selfUpdate?.enabled ? [`persona-workspace-${name}:/home/persona/workspace`] : []),
    ],
    environment,
    // Engine uses bridge network (shared with tunnel), not "none"
    networks: [`persona-${name}`],
    deploy: {
      resources: {
        limits: {
          memory: memoryLimit,
          cpus: cpuLimit,
        },
      },
    },
    read_only: true,
    tmpfs: ["/tmp"],
    restart: "unless-stopped",
    ...(webhookUrl ? {
      healthcheck: {
        test: ["CMD", "curl", "-f", `http://localhost:${port}/health`],
        interval: "30s",
        timeout: "5s",
        retries: 3,
        start_period: "30s",
      },
    } : {}),
  }

  const services: Record<string, ComposeService> = { engine }
  const networks: Record<string, ComposeService> = {
    [`persona-${name}`]: { driver: "bridge" },
  }
  const volumes: Record<string, ComposeService> = {}

  if (selfUpdate?.enabled) {
    volumes[`persona-workspace-${name}`] = {}
  }

  // Tunnel service (optional, only when tunnel config exists)
  if (tunnelConfigDir) {
    services.tunnel = {
      image: "cloudflare/cloudflared:latest",
      command: ["tunnel", "--config", "/etc/cloudflared/config.yml", "run"],
      volumes: [
        `${tunnelConfigDir}:/etc/cloudflared:ro`,
      ],
      networks: [`persona-${name}`],
      restart: "unless-stopped",
      depends_on: ["engine"],
    }
  }

  const compose = {
    services,
    networks,
    ...(Object.keys(volumes).length > 0 ? { volumes } : {}),
  }

  // Write to a temp dir so we don't pollute the project
  const outDir = join(tmpdir(), `persona-compose-${name}`)
  mkdirSync(outDir, { recursive: true })
  const composePath = join(outDir, "docker-compose.yml")
  writeFileSync(composePath, stringify(compose, { lineWidth: 0 }))

  return composePath
}

/**
 * Get the project directory (where Dockerfile lives).
 */
export function getProjectDir(): string {
  return PROJECT_DIR
}
