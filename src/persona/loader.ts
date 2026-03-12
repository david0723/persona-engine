import { readFileSync, existsSync } from "node:fs"
import { parse } from "yaml"
import { paths } from "../utils/config.js"
import type { PersonaDefinition } from "./schema.js"

export function loadPersona(name: string): PersonaDefinition {
  const yamlPath = paths.personaYaml(name)

  if (!existsSync(yamlPath)) {
    throw new Error(`Persona "${name}" not found at ${yamlPath}`)
  }

  const raw = readFileSync(yamlPath, "utf-8")
  const parsed = parse(raw) as Record<string, unknown>

  return validatePersona(parsed)
}

function validatePersona(data: Record<string, unknown>): PersonaDefinition {
  const errors: string[] = []

  if (typeof data.name !== "string") errors.push("name must be a string")

  const identity = data.identity as Record<string, unknown> | undefined
  if (!identity || typeof identity !== "object") {
    errors.push("identity must be an object")
  } else {
    if (typeof identity.role !== "string") errors.push("identity.role must be a string")
    if (typeof identity.speaking_style !== "string") errors.push("identity.speaking_style must be a string")
    if (!Array.isArray(identity.values)) errors.push("identity.values must be an array")
  }

  if (typeof data.backstory !== "string") errors.push("backstory must be a string")
  if (typeof data.instructions !== "string") errors.push("instructions must be a string")
  // mcp_servers and container are optional, no validation needed

  const heartbeat = data.heartbeat as Record<string, unknown> | undefined
  if (!heartbeat || typeof heartbeat !== "object") {
    errors.push("heartbeat must be an object")
  } else {
    if (typeof heartbeat.enabled !== "boolean") errors.push("heartbeat.enabled must be a boolean")
    if (typeof heartbeat.interval_minutes !== "number") errors.push("heartbeat.interval_minutes must be a number")
    if (!Array.isArray(heartbeat.activities)) errors.push("heartbeat.activities must be an array")
  }

  if (errors.length > 0) {
    throw new Error(`Invalid persona definition:\n  - ${errors.join("\n  - ")}`)
  }

  return data as unknown as PersonaDefinition
}

export function personaExists(name: string): boolean {
  return existsSync(paths.personaYaml(name))
}
