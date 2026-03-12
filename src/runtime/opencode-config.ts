import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { paths, ensurePersonaDir } from "../utils/config.js"
import type { PersonaDefinition } from "../persona/schema.js"

interface OpenCodeConfig {
  $schema: string
  mcp?: Record<string, unknown>
  permission?: Record<string, string>
}

export function writeOpenCodeConfig(persona: PersonaDefinition): string {
  ensurePersonaDir(persona.name)
  const configPath = join(paths.personaDir(persona.name), "opencode.json")

  const config: OpenCodeConfig = {
    $schema: "https://opencode.ai/config.json",
  }

  if (persona.mcp_servers && Object.keys(persona.mcp_servers).length > 0) {
    config.mcp = persona.mcp_servers
  }

  // If containerized and no explicit permissions, default to full autonomy inside cage
  if (persona.container?.enabled && !persona.permissions) {
    config.permission = { bash: "allow", edit: "allow", read: "allow" }
  } else if (persona.permissions) {
    config.permission = { ...persona.permissions }
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
  return configPath
}
