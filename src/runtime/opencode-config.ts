import { writeFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { paths, ensurePersonaDir } from "../utils/config.js"
import { buildSystemPrompt } from "./prompt-builder.js"
import type { PersonaDefinition } from "../persona/schema.js"
import type { MemoryStore } from "../memory/store.js"

interface AgentConfig {
  mode?: "primary" | "subagent"
  prompt?: string
  tools?: Record<string, boolean>
}

interface OpenCodeConfig {
  $schema: string
  instructions?: string[]
  mcp?: Record<string, unknown>
  permission?: Record<string, string>
  plugin?: Record<string, string>
  agent?: Record<string, AgentConfig>
}

export function writeOpenCodeConfig(persona: PersonaDefinition): string {
  ensurePersonaDir(persona.name)
  const configPath = join(paths.personaDir(persona.name), "opencode.json")

  const instructions = ["INSTRUCTIONS.md"]

  // When vault is enabled, load all SKILL.md files and preferences as instructions
  // so the AI always knows project conventions without reading files first
  if (persona.vault?.enabled) {
    const vaultPath = persona.vault.path ?? "/home/persona/vault"
    instructions.push(`${vaultPath}/*/SKILL.md`)
    instructions.push(`${vaultPath}/Preferences/preferences.md`)
  }

  const config: OpenCodeConfig = {
    $schema: "https://opencode.ai/config.json",
    instructions,
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

  // Auto-inject vault tools when vault is enabled
  if (persona.vault?.enabled) {
    const vaultPath = persona.vault.path ?? "/home/persona/vault"
    const dbPath = persona.vault.path
      ? join(persona.vault.path, "..", ".vault-search.db")
      : "/home/persona/.vault-search.db"
    const distDir = dirname(fileURLToPath(import.meta.url))

    // MCP server for vault search (fallback for older opencode versions)
    config.mcp = config.mcp ?? {}
    config.mcp["vault-search"] = {
      type: "local",
      command: ["node", join(distDir, "..", "vault", "mcp-server.js")],
      environment: {
        VAULT_PATH: vaultPath,
        VAULT_DB_PATH: dbPath,
      },
    }

    // OpenCode plugin for native tools + compaction hook
    config.plugin = config.plugin ?? {}
    config.plugin["vault"] = join(distDir, "..", "vault", "opencode-plugin.js")

    // Task-specific subagents for vault operations
    config.agent = {
      "brain-dump-processor": {
        mode: "subagent",
        prompt: `You are a brain dump processor. Your job is to take raw, unstructured brain dumps and extract:
1. **Tasks** - actionable items with priorities. Add to Todos/Active.md.
2. **Ideas** - things worth exploring later. Add to Ideas/.
3. **Journal entries** - reflections or emotional content. Add to Journal/.
4. **Project notes** - content related to existing projects. File under the relevant project.

Always read INDEX.md first to know which projects exist.
Catalog the raw content first, then process it. Never lose information.`,
        tools: { write: true, edit: true, bash: false },
      },
      "journal-writer": {
        mode: "subagent",
        prompt: `You are a journal writer. Keep the user's voice and tone.
Don't over-structure entries. Add a timestamp heading for each entry.
Write to Journal/YYYY-MM-DD.md. Create the file if it doesn't exist.
Be reflective but genuine - don't add fluff.`,
        tools: { write: true, edit: true, bash: false },
      },
      "todo-manager": {
        mode: "subagent",
        prompt: `You are a task manager. Your job is to:
1. Read Todos/Active.md and understand current tasks
2. Add new tasks with appropriate priority (High/Normal/Low)
3. Check for duplicates before adding
4. Include the source in parentheses
5. Mark completed tasks with [x]
6. Move completed tasks to Archive/Todos/ periodically

Always read the SKILL.md and COMMAND.md in Todos/ first.`,
        tools: { write: true, edit: true, bash: false },
      },
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

/**
 * Write the persona's system prompt to INSTRUCTIONS.md in the persona data dir.
 * opencode picks this up via the `instructions` field in opencode.json.
 */
export function writeInstructionsFile(persona: PersonaDefinition, store: MemoryStore): void {
  const prompt = buildSystemPrompt(persona, store)
  const instrPath = join(paths.personaDir(persona.name), "INSTRUCTIONS.md")
  writeFileSync(instrPath, prompt, "utf-8")
}
