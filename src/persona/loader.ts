import { readFileSync, existsSync } from "node:fs"
import { parse } from "yaml"
import { paths } from "../utils/config.js"
import type { PersonaDefinition, PersonaFeatures } from "./schema.js"

export function resolveFeatures(raw?: Partial<PersonaFeatures>): PersonaFeatures {
  return {
    identity: raw?.identity ?? true,
    memory: raw?.memory ?? true,
    journal: raw?.journal ?? true,
    conversation_summary: raw?.conversation_summary ?? true,
  }
}

export function loadPersona(name: string): PersonaDefinition {
  const yamlPath = paths.personaYaml(name)

  if (!existsSync(yamlPath)) {
    throw new Error(`Persona "${name}" not found at ${yamlPath}`)
  }

  const raw = readFileSync(yamlPath, "utf-8")
  const parsed = parse(raw) as Record<string, unknown>

  return validatePersona(parsed)
}

export function validatePersona(data: Record<string, unknown>): PersonaDefinition {
  const errors: string[] = []

  if (typeof data.name !== "string") errors.push("name must be a string")

  // Validate features block if present
  if (data.features != null) {
    const feat = data.features as Record<string, unknown>
    if (typeof feat !== "object") {
      errors.push("features must be an object")
    } else {
      for (const key of ["identity", "memory", "journal", "conversation_summary"]) {
        if (feat[key] != null && typeof feat[key] !== "boolean")
          errors.push(`features.${key} must be a boolean`)
      }
    }
  }

  const features = resolveFeatures(data.features as Partial<PersonaFeatures> | undefined)

  // Identity/backstory/instructions are required only when features.identity is true
  if (features.identity) {
    const identity = data.identity as Record<string, unknown> | undefined
    if (!identity || typeof identity !== "object") {
      errors.push("identity must be an object when features.identity is true")
    } else {
      if (typeof identity.role !== "string") errors.push("identity.role must be a string")
      if (typeof identity.speaking_style !== "string") errors.push("identity.speaking_style must be a string")
      if (!Array.isArray(identity.values)) errors.push("identity.values must be an array")
    }

    if (typeof data.backstory !== "string") errors.push("backstory must be a string when features.identity is true")
    if (typeof data.instructions !== "string") errors.push("instructions must be a string when features.identity is true")
  }
  // Validate optional container config
  if (data.container != null) {
    const container = data.container as Record<string, unknown>
    if (typeof container !== "object") {
      errors.push("container must be an object")
    } else {
      if (container.enabled != null && typeof container.enabled !== "boolean")
        errors.push("container.enabled must be a boolean")
      if (container.network != null && !["none", "bridge", "host"].includes(container.network as string))
        errors.push('container.network must be "none", "bridge", or "host"')
      if (container.memory_limit != null && typeof container.memory_limit !== "string")
        errors.push("container.memory_limit must be a string")
      if (container.cpu_limit != null && typeof container.cpu_limit !== "string")
        errors.push("container.cpu_limit must be a string")
      if (container.allowed_env != null && !Array.isArray(container.allowed_env))
        errors.push("container.allowed_env must be an array of strings")
      if (container.docker_socket != null && typeof container.docker_socket !== "boolean")
        errors.push("container.docker_socket must be a boolean")
    }
  }

  // Validate optional vault config
  if (data.vault != null) {
    const vault = data.vault as Record<string, unknown>
    if (typeof vault !== "object") {
      errors.push("vault must be an object")
    } else {
      if (typeof vault.enabled !== "boolean")
        errors.push("vault.enabled must be a boolean")
      if (vault.path != null && typeof vault.path !== "string")
        errors.push("vault.path must be a string")
      if (vault.host_path != null && typeof vault.host_path !== "string")
        errors.push("vault.host_path must be a string")
    }
  }

  // Validate optional permissions config
  const validPermValues = ["allow", "ask", "deny"]
  if (data.permissions != null) {
    const perms = data.permissions as Record<string, unknown>
    if (typeof perms !== "object") {
      errors.push("permissions must be an object")
    } else {
      for (const key of ["bash", "edit", "read", "external_directory"]) {
        if (perms[key] != null && !validPermValues.includes(perms[key] as string))
          errors.push(`permissions.${key} must be "allow", "ask", or "deny"`)
      }
    }
  }

  // Validate optional self_update config
  if (data.self_update != null) {
    const su = data.self_update as Record<string, unknown>
    if (typeof su !== "object") {
      errors.push("self_update must be an object")
    } else {
      if (typeof su.enabled !== "boolean")
        errors.push("self_update.enabled must be a boolean")
      if (su.repo_url != null && typeof su.repo_url !== "string")
        errors.push("self_update.repo_url must be a string")
      if (su.branch != null && typeof su.branch !== "string")
        errors.push("self_update.branch must be a string")
    }
  }

  const heartbeat = data.heartbeat as Record<string, unknown> | undefined
  if (!heartbeat || typeof heartbeat !== "object") {
    errors.push("heartbeat must be an object")
  } else {
    if (typeof heartbeat.enabled !== "boolean") errors.push("heartbeat.enabled must be a boolean")
    if (typeof heartbeat.interval_minutes !== "number") errors.push("heartbeat.interval_minutes must be a number")
    if (!Array.isArray(heartbeat.activities)) errors.push("heartbeat.activities must be an array")
    if (heartbeat.prompt != null && typeof heartbeat.prompt !== "string")
      errors.push("heartbeat.prompt must be a string")
    if (heartbeat.notify != null && typeof heartbeat.notify !== "boolean")
      errors.push("heartbeat.notify must be a boolean")
  }

  if (errors.length > 0) {
    throw new Error(`Invalid persona definition:\n  - ${errors.join("\n  - ")}`)
  }

  return data as unknown as PersonaDefinition
}

export function personaExists(name: string): boolean {
  return existsSync(paths.personaYaml(name))
}
