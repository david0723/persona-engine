import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const HOME = process.env.PERSONA_ENGINE_HOME ?? join(homedir(), ".persona-engine")

export const paths = {
  home: HOME,
  personas: join(HOME, "personas"),
  personaDir: (name: string) => join(HOME, "personas", name),
  personaYaml: (name: string) => join(HOME, "personas", name, "persona.yaml"),
  memoryDb: (name: string) => join(HOME, "personas", name, "memory.db"),
  heartbeatLog: (name: string) => join(HOME, "personas", name, "heartbeat.log"),
} as const

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export function ensurePersonaDir(name: string): void {
  ensureDir(paths.personaDir(name))
}
