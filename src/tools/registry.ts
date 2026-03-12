import type { MemoryStore } from "../memory/store.js"
import type { PersonaDefinition } from "../persona/schema.js"
import type Anthropic from "@anthropic-ai/sdk"

export interface ToolContext {
  persona: PersonaDefinition
  store: MemoryStore
  sessionId: string
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Anthropic.Tool["input_schema"]
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<string>
}

const registry = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  registry.set(tool.name, tool)
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name)
}

export function resolveTools(names: string[]): ToolDefinition[] {
  return names
    .map(name => registry.get(name))
    .filter((t): t is ToolDefinition => t !== undefined)
}

export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))
}
