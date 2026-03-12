import { mkdirSync, readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const HOME = process.env.PERSONA_ENGINE_HOME ?? join(homedir(), ".persona-engine")

export const paths = {
  home: HOME,
  personas: join(HOME, "personas"),
  personaDir: (name: string) => join(HOME, "personas", name),
  personaYaml: (name: string) => join(HOME, "personas", name, "persona.yaml"),
  personaEnv: (name: string) => join(HOME, "personas", name, ".env"),
  memoryDb: (name: string) => join(HOME, "personas", name, "memory.db"),
  heartbeatLog: (name: string) => join(HOME, "personas", name, "heartbeat.log"),
} as const

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export function ensurePersonaDir(name: string): void {
  ensureDir(paths.personaDir(name))
}

/**
 * Load environment variables from a persona's .env file.
 * Returns a plain object - does NOT inject into process.env.
 */
export function loadPersonaEnv(name: string): Record<string, string> {
  const envPath = paths.personaEnv(name)
  if (!existsSync(envPath)) return {}

  const content = readFileSync(envPath, "utf-8")
  const env: Record<string, string> = {}

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const eqIndex = trimmed.indexOf("=")
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    env[key] = value
  }

  return env
}
