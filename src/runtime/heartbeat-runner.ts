import { GoogleGenAI, type FunctionCall, type Part } from "@google/genai"
import { randomUUID } from "node:crypto"
import { appendFileSync } from "node:fs"
import { buildSystemPrompt } from "./prompt-builder.js"
import { resolveTools, toGeminiFunctionDeclarations, getTool } from "../tools/registry.js"
import type { ToolContext } from "../tools/registry.js"
import { MemoryStore } from "../memory/store.js"
import { paths } from "../utils/config.js"
import type { PersonaDefinition } from "../persona/schema.js"

import "../tools/index.js"

const HEARTBEAT_MODEL = "gemini-2.5-flash"

export async function runHeartbeat(persona: PersonaDefinition): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const store = new MemoryStore(persona.name)
  const sessionId = `heartbeat-${randomUUID()}`
  const tools = resolveTools(persona.tools)
  const functionDeclarations = toGeminiFunctionDeclarations(tools)
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
    const chat = ai.chats.create({
      model: HEARTBEAT_MODEL,
      config: {
        systemInstruction: heartbeatPrompt,
        tools: functionDeclarations.length > 0
          ? [{ functionDeclarations }]
          : undefined,
        maxOutputTokens: 2048,
      },
    })

    let response = await chat.sendMessage({
      message: "It's time for your private reflection. What's on your mind?",
    })

    // Process up to 3 rounds of tool calls
    let rounds = 0
    while (response.functionCalls && response.functionCalls.length > 0 && rounds < 3) {
      rounds++

      const functionResponses: Part[] = []
      for (const call of response.functionCalls) {
        const tool = getTool(call.name ?? "")
        const args = (call.args ?? {}) as Record<string, unknown>
        const result = tool
          ? await tool.execute(args, toolContext)
          : `Unknown tool: ${call.name}`

        log(logPath, `[tool: ${call.name}] ${JSON.stringify(args).slice(0, 200)}`)
        log(logPath, `[result] ${result.slice(0, 200)}`)

        functionResponses.push({
          functionResponse: {
            name: call.name ?? "",
            response: { result },
          },
        })
      }

      response = await chat.sendMessage({ message: functionResponses })
    }

    const text = response.text ?? ""
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
