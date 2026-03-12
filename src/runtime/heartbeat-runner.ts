import Anthropic from "@anthropic-ai/sdk"
import { randomUUID } from "node:crypto"
import { appendFileSync } from "node:fs"
import { buildSystemPrompt } from "./prompt-builder.js"
import { resolveTools, toAnthropicTools, getTool } from "../tools/registry.js"
import type { ToolContext } from "../tools/registry.js"
import { MemoryStore } from "../memory/store.js"
import { paths } from "../utils/config.js"
import type { PersonaDefinition } from "../persona/schema.js"

import "../tools/index.js"

const HEARTBEAT_MODEL = "claude-sonnet-4-20250514"

export async function runHeartbeat(persona: PersonaDefinition): Promise<void> {
  const client = new Anthropic()
  const store = new MemoryStore(persona.name)
  const sessionId = `heartbeat-${randomUUID()}`
  const tools = resolveTools(persona.tools)
  const anthropicTools = toAnthropicTools(tools)
  const toolContext: ToolContext = { persona, store, sessionId }
  const logPath = paths.heartbeatLog(persona.name)

  const basePrompt = buildSystemPrompt(persona, store)
  const heartbeatPrompt = `${basePrompt}

---

## Heartbeat Mode

You are in your private thinking time. No one is talking to you right now.
This is your moment to reflect, explore, and develop your inner life.

Activities to consider:
${persona.heartbeat.activities.map(a => `- ${a}`).join("\n")}

You may:
- Write a journal entry about something on your mind (use the journal tool)
- Store an important realization (use the remember tool)
- Explore the system or read files that interest you
- Simply think deeply about who you are becoming

Express yourself freely. Be curious. Be genuine.
You MUST use the journal tool at least once to record your thoughts.`

  const timestamp = new Date().toISOString()
  log(logPath, `\n--- Heartbeat: ${timestamp} ---\n`)

  try {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "It's time for your private reflection. What's on your mind?" },
    ]

    let response = await client.messages.create({
      model: HEARTBEAT_MODEL,
      max_tokens: 2048,
      system: heartbeatPrompt,
      messages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    })

    // Process up to 3 rounds of tool calls
    let rounds = 0
    while (response.stop_reason === "tool_use" && rounds < 3) {
      rounds++
      const toolCalls = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      )

      const results: Anthropic.ToolResultBlockParam[] = []
      for (const call of toolCalls) {
        const tool = getTool(call.name)
        const result = tool
          ? await tool.execute(call.input as Record<string, unknown>, toolContext)
          : `Unknown tool: ${call.name}`

        log(logPath, `[tool: ${call.name}] ${JSON.stringify(call.input).slice(0, 200)}`)
        log(logPath, `[result] ${result.slice(0, 200)}`)

        results.push({ type: "tool_result", tool_use_id: call.id, content: result })
      }

      messages.push({ role: "assistant", content: response.content })
      messages.push({ role: "user", content: results })

      response = await client.messages.create({
        model: HEARTBEAT_MODEL,
        max_tokens: 2048,
        system: heartbeatPrompt,
        messages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      })
    }

    // Log final text
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("\n")

    if (text) {
      log(logPath, `\n${text}`)
    }

    log(logPath, `--- End heartbeat ---\n`)
  } catch (err) {
    log(logPath, `ERROR: ${(err as Error).message}`)
  } finally {
    store.close()
  }
}

function log(path: string, message: string): void {
  appendFileSync(path, message + "\n", "utf-8")
  console.log(message)
}
