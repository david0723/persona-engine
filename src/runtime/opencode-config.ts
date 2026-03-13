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
    config.mcp = { ...persona.mcp_servers }
  }

  // Auto-inject Brave Search MCP when API key is available and not already defined
  const braveApiKey = process.env.BRAVE_API_KEY
  if (braveApiKey && !config.mcp?.["Brave Search"]) {
    const hasNetwork =
      !persona.container?.enabled ||
      (persona.container.network && persona.container.network !== "none")
    if (hasNetwork) {
      config.mcp = config.mcp ?? {}
      config.mcp["Brave Search"] = {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-brave-search"],
        environment: { BRAVE_API_KEY: braveApiKey },
      }
    }
  }

  // If containerized and no explicit permissions, default to full autonomy inside cage
  if (persona.container?.enabled && !persona.permissions) {
    config.permission = { bash: "allow", edit: "allow", read: "allow", external_directory: "allow" }
  } else if (persona.permissions) {
    config.permission = { ...persona.permissions }
    // Inside a container, the container IS the sandbox - allow external directory access
    // unless the user explicitly restricted it
    if (persona.container?.enabled && !persona.permissions.external_directory) {
      config.permission.external_directory = "allow"
    }
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
  return configPath
}
