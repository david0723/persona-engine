import { execFileSync, execSync, spawnSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { paths, loadPersonaEnv } from "../utils/config.js"
import type { PersonaDefinition } from "../persona/schema.js"

const DEFAULT_IMAGE = "persona-engine:latest"
const DOCKERFILE_PATH = join(import.meta.dirname, "..", "..", "Dockerfile")

/**
 * When running inside the full-stack container (PERSONA_ENGINE_CONTAINERIZED=true),
 * opencode is already in the same container. Skip all Docker-in-Docker logic.
 */
export function isContainerized(): boolean {
  return process.env.PERSONA_ENGINE_CONTAINERIZED === "true"
}

function containerName(personaName: string): string {
  return `persona-${personaName.replace(/[^a-zA-Z0-9-]/g, "-")}`
}

function imageName(persona: PersonaDefinition): string {
  return persona.container?.image ?? DEFAULT_IMAGE
}

function buildEnvVars(persona: PersonaDefinition): string[] {
  // Load all env vars from the persona's own .env file
  const personaEnv = loadPersonaEnv(persona.name)
  const envVars: string[] = []

  for (const [key, value] of Object.entries(personaEnv)) {
    envVars.push(`${key}=${value}`)
  }

  // Inject repo URL from self_update config if not already set
  if (persona.self_update?.enabled && persona.self_update.repo_url && !personaEnv.PERSONA_ENGINE_REPO_URL) {
    envVars.push(`PERSONA_ENGINE_REPO_URL=${persona.self_update.repo_url}`)
  }

  return envVars
}

export function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5000 })
    return true
  } catch {
    // Docker not responding, try to start it (macOS Docker Desktop)
    return tryStartDocker()
  }
}

function tryStartDocker(): boolean {
  const isDarwin = process.platform === "darwin"

  if (isDarwin) {
    try {
      execSync("open -a Docker", { stdio: "pipe", timeout: 10000 })
    } catch {
      return false // Docker Desktop not installed
    }
  } else {
    // Linux: try systemctl
    try {
      execSync("systemctl start docker", { stdio: "pipe", timeout: 10000 })
    } catch {
      return false
    }
  }

  // Wait for Docker daemon to become ready (up to 30s)
  console.log("Starting Docker daemon...")
  const maxWait = 30
  for (let i = 0; i < maxWait; i++) {
    try {
      execSync("docker info", { stdio: "pipe", timeout: 5000 })
      console.log("Docker is ready.")
      return true
    } catch {
      spawnSync("sleep", ["1"])
    }
  }

  return false
}

export function isContainerRunning(persona: PersonaDefinition): boolean {
  try {
    const result = execSync(
      `docker inspect -f '{{.State.Running}}' ${containerName(persona.name)}`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim()
    return result === "true"
  } catch {
    return false
  }
}

export function ensureContainer(persona: PersonaDefinition): void {
  if (isContainerized()) return // Already inside the full-stack container

  if (!isDockerAvailable()) {
    throw new Error("Docker is not running. Start Docker Desktop or disable container mode in persona.yaml (container.enabled: false)")
  }

  ensureImage(persona)

  if (isContainerRunning(persona)) return

  // Remove old stopped container if it exists
  try {
    execSync(`docker rm ${containerName(persona.name)}`, { stdio: "pipe" })
  } catch {
    // Doesn't exist, that's fine
  }

  const personaDir = paths.personaDir(persona.name)
  const name = containerName(persona.name)
  const containerConfig = persona.container ?? { enabled: true }

  // Build docker run arguments
  const args = [
    "run", "-d",
    "--name", name,
    "-v", `${personaDir}:/home/persona/data`,
    "-w", "/home/persona",
    "--restart", "unless-stopped",
  ]

  // Persist workspace across container restarts
  args.push("-v", `persona-workspace-${persona.name}:/home/persona/workspace`)

  // Apply resource limits
  if (containerConfig.memory_limit) {
    args.push("--memory", containerConfig.memory_limit)
  }
  if (containerConfig.cpu_limit) {
    args.push("--cpus", containerConfig.cpu_limit)
  }
  if (containerConfig.network) {
    args.push("--network", containerConfig.network)
  }

  // Pass environment variables
  const envVars = buildEnvVars(persona)
  for (const env of envVars) {
    args.push("-e", env)
  }

  // Keep the container alive with sleep; we exec into it for opencode calls
  args.push("--entrypoint", "sleep", imageName(persona), "infinity")

  execSync(["docker", ...args].map(a => `"${a}"`).join(" "), { stdio: "pipe" })

  // Wait for the container to be fully running before returning
  waitForContainer(name)

  // Clone or update the workspace repo inside the running container
  if (persona.self_update?.enabled && persona.self_update.repo_url) {
    setupWorkspace(persona)
  }
}

function waitForContainer(name: string): void {
  for (let i = 0; i < 10; i++) {
    try {
      const state = execSync(
        `docker inspect -f '{{.State.Running}}' ${name}`,
        { encoding: "utf-8", stdio: "pipe", timeout: 5000 }
      ).trim()
      if (state === "true") {
        // Verify we can actually exec into it
        execSync(`docker exec ${name} true`, { stdio: "pipe", timeout: 5000 })
        return
      }
    } catch {
      // Not ready yet
    }
    spawnSync("sleep", ["1"])
  }
  throw new Error(`Container ${name} failed to become ready`)
}

export function execInContainer(
  persona: PersonaDefinition,
  command: string[],
): string {
  const name = containerName(persona.name)

  return execFileSync("docker", ["exec", name, ...command], {
    encoding: "utf-8",
    timeout: 300000, // 5 minutes
    maxBuffer: 1024 * 1024 * 10,
    stdio: ["pipe", "pipe", "pipe"],
  })
}

export function execInContainerStreaming(
  persona: PersonaDefinition,
  command: string[],
  onFirstChunk?: () => void,
  onChunk?: (text: string) => void,
): Promise<string> {
  const name = containerName(persona.name)

  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", name, ...command], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    let output = ""
    let stderrOutput = ""
    let firstChunkFired = false

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString()
      if (!firstChunkFired) {
        firstChunkFired = true
        onFirstChunk?.()
      }
      output += text
      if (onChunk) {
        onChunk(text)
      } else {
        process.stdout.write(text)
      }
    })

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString()
      stderrOutput += text
      if (onChunk) return // Ink controls the terminal - suppress stderr during streaming
      if (!text.includes("MetadataLookup") && !text.includes("warn")) {
        process.stderr.write(data)
      }
    })

    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve(output)
      } else {
        reject(new Error(`Container command exited with code ${code}: ${stderrOutput.trim()}`))
      }
    })

    child.on("error", reject)
  })
}

function setupWorkspace(persona: PersonaDefinition): void {
  const name = containerName(persona.name)
  const repoUrl = persona.self_update!.repo_url!
  const repoDir = "/home/persona/workspace/persona-engine"

  // Build a setup script that clones or pulls the repo
  const script = [
    "set -e",
    `REPO_DIR="${repoDir}"`,
    `REPO_URL="${repoUrl}"`,
    "",
    'if [ ! -d "$REPO_DIR/.git" ]; then',
    '  echo "[setup] Cloning $REPO_URL..."',
    '  mkdir -p /home/persona/workspace',
    '  git clone "$REPO_URL" "$REPO_DIR"',
    "else",
    '  echo "[setup] Pulling latest changes..."',
    '  cd "$REPO_DIR"',
    '  git pull --ff-only || echo "[setup] Pull failed (non-fast-forward), continuing with existing code"',
    "fi",
    "",
    'cd "$REPO_DIR"',
    'git config user.name "persona-engine"',
    'git config user.email "persona@engine"',
    "",
    'if [ -n "$GITHUB_TOKEN" ]; then',
    "  git config credential.helper '!f() { echo \"username=x-access-token\"; echo \"password=$GITHUB_TOKEN\"; }; f'",
    "fi",
    "",
    'echo "[setup] Workspace ready at $REPO_DIR"',
  ].join("\n")

  try {
    execFileSync("docker", ["exec", name, "bash", "-c", script], {
      encoding: "utf-8",
      timeout: 120000,
      stdio: "pipe",
    })
  } catch (err) {
    // Log but don't fail - the agent can still work without the repo
    console.error(`[container] Workspace setup failed: ${(err as Error).message}`)
  }
}

export function stopContainer(persona: PersonaDefinition): void {
  try {
    execSync(`docker stop ${containerName(persona.name)}`, { stdio: "pipe" })
    execSync(`docker rm ${containerName(persona.name)}`, { stdio: "pipe" })
  } catch {
    // Already stopped
  }
}

function ensureImage(persona: PersonaDefinition): void {
  const image = imageName(persona)

  try {
    execSync(`docker image inspect ${image}`, { stdio: "pipe" })
    return // Image exists
  } catch {
    // Need to build
  }

  if (!existsSync(DOCKERFILE_PATH)) {
    throw new Error(`Dockerfile not found at ${DOCKERFILE_PATH}. Run 'persona build-image' first.`)
  }

  console.log(`Building Docker image ${image}...`)
  execSync(`docker build -t ${image} -f ${DOCKERFILE_PATH} ${join(DOCKERFILE_PATH, "..")}`, {
    stdio: "inherit",
    timeout: 300000,
  })
}
