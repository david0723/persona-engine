import { execFileSync, execSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { paths } from "../utils/config.js"
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

export function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5000 })
    return true
  } catch {
    return false
  }
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

  // Start a persistent container with the persona's directory mounted
  execSync([
    "docker", "run", "-d",
    "--name", name,
    "-v", `${personaDir}:/home/persona/data`,
    "-w", "/home/persona",
    "--restart", "unless-stopped",
    imageName(persona),
    "sleep", "infinity",
  ].join(" "), { stdio: "pipe" })
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
): Promise<string> {
  const name = containerName(persona.name)

  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", name, ...command], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    let output = ""

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString()
      output += text
      process.stdout.write(text)
    })

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString()
      if (!text.includes("MetadataLookup") && !text.includes("warn")) {
        process.stderr.write(data)
      }
    })

    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve(output)
      } else {
        reject(new Error(`Container command exited with code ${code}`))
      }
    })

    child.on("error", reject)
  })
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
