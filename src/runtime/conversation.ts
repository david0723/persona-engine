import Anthropic from "@anthropic-ai/sdk"
import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import { buildSystemPrompt, trimTurnsToFit } from "./prompt-builder.js"
import { resolveTools, toAnthropicTools, getTool } from "../tools/registry.js"
import type { ToolContext } from "../tools/registry.js"
import { MemoryStore } from "../memory/store.js"
import { summarizeSession } from "../memory/summarizer.js"
import { writeChunk, writeLine, writePersonaHeader, writeUserPrompt, writeSystem, writeToolUse } from "../utils/stream.js"
import type { PersonaDefinition } from "../persona/schema.js"

// Import tools to register them
import "../tools/index.js"

type Message = Anthropic.MessageParam

const CHAT_MODEL = "claude-sonnet-4-20250514"

export async function startChat(persona: PersonaDefinition): Promise<void> {
  const client = new Anthropic()
  const store = new MemoryStore(persona.name)
  const sessionId = randomUUID()
  const tools = resolveTools(persona.tools)
  const anthropicTools = toAnthropicTools(tools)

  const systemPrompt = buildSystemPrompt(persona, store)
  const messages: Message[] = []

  const toolContext: ToolContext = { persona, store, sessionId }

  writeSystem(`\nChatting with ${persona.name}. Press Ctrl+D to exit.\n`)

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  // Handle graceful exit
  const cleanup = async () => {
    writeSystem("\n\nSaving memories...")
    const turns = store.getTurnsBySession(sessionId)
    if (turns.length >= 2) {
      await summarizeSession(sessionId, store)
      writeSystem("Session summarized.")
    }
    store.close()
    writeSystem("Goodbye.\n")
    process.exit(0)
  }

  process.on("SIGINT", cleanup)

  const askQuestion = (): Promise<string | null> => {
    return new Promise(resolve => {
      writeUserPrompt()

      const lineHandler = (line: string) => {
        rl.removeListener("line", lineHandler)
        rl.removeListener("close", closeHandler)
        resolve(line)
      }
      const closeHandler = () => {
        rl.removeListener("line", lineHandler)
        resolve(null)
      }

      rl.once("line", lineHandler)
      rl.once("close", closeHandler)
    })
  }

  while (true) {
    const userInput = await askQuestion()

    if (userInput === null) {
      await cleanup()
      break
    }

    if (userInput.trim() === "") continue

    messages.push({ role: "user", content: userInput })
    store.addTurn(sessionId, "user", userInput)

    const trimmed = trimTurnsToFit(
      messages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
    )

    try {
      const response = await sendMessage(client, systemPrompt, messages, anthropicTools)
      const { text, toolCalls } = extractResponse(response)

      // Handle tool calls
      if (toolCalls.length > 0) {
        const toolResults = await executeTools(toolCalls, toolContext)

        // Add assistant response + tool results
        messages.push({ role: "assistant", content: response.content })
        messages.push({ role: "user", content: toolResults })

        // Get follow-up response after tools
        const followUp = await sendMessage(client, systemPrompt, messages, anthropicTools)
        const followUpResult = extractResponse(followUp)

        if (followUpResult.text) {
          writePersonaHeader(persona.name)
          writeLine(followUpResult.text)
          messages.push({ role: "assistant", content: followUp.content })
          store.addTurn(sessionId, "assistant", followUpResult.text)
        }
      } else if (text) {
        writePersonaHeader(persona.name)
        writeLine(text)
        messages.push({ role: "assistant", content: response.content })
        store.addTurn(sessionId, "assistant", text)
      }
    } catch (err) {
      writeSystem(`Error: ${(err as Error).message}`)
    }

    writeLine()
  }
}

async function sendMessage(
  client: Anthropic,
  system: string,
  messages: Message[],
  tools: Anthropic.Tool[],
): Promise<Anthropic.Message> {
  return client.messages.create({
    model: CHAT_MODEL,
    max_tokens: 2048,
    system,
    messages,
    tools: tools.length > 0 ? tools : undefined,
  })
}

function extractResponse(message: Anthropic.Message): {
  text: string
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
} {
  let text = ""
  const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

  for (const block of message.content) {
    if (block.type === "text") {
      text += block.text
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      })
    }
  }

  return { text, toolCalls }
}

async function executeTools(
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  context: ToolContext,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = []

  for (const call of toolCalls) {
    const tool = getTool(call.name)
    let resultContent: string

    if (!tool) {
      resultContent = `Unknown tool: ${call.name}`
    } else {
      writeToolUse(call.name, JSON.stringify(call.input).slice(0, 100))
      resultContent = await tool.execute(call.input, context)
    }

    results.push({
      type: "tool_result",
      tool_use_id: call.id,
      content: resultContent,
    })
  }

  return results
}
