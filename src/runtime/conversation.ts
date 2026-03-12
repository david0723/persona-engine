import { GoogleGenAI, type Content, type Part, type FunctionCall } from "@google/genai"
import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import { buildSystemPrompt } from "./prompt-builder.js"
import { resolveTools, toGeminiFunctionDeclarations, getTool } from "../tools/registry.js"
import type { ToolContext } from "../tools/registry.js"
import { MemoryStore } from "../memory/store.js"
import { summarizeSession } from "../memory/summarizer.js"
import { writeLine, writePersonaHeader, writeUserPrompt, writeSystem, writeToolUse } from "../utils/stream.js"
import type { PersonaDefinition } from "../persona/schema.js"

import "../tools/index.js"

const CHAT_MODEL = "gemini-2.5-flash"

export async function startChat(persona: PersonaDefinition): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const store = new MemoryStore(persona.name)
  const sessionId = randomUUID()
  const tools = resolveTools(persona.tools)
  const functionDeclarations = toGeminiFunctionDeclarations(tools)

  const systemPrompt = buildSystemPrompt(persona, store)
  const toolContext: ToolContext = { persona, store, sessionId }

  const chat = ai.chats.create({
    model: CHAT_MODEL,
    config: {
      systemInstruction: systemPrompt,
      tools: functionDeclarations.length > 0
        ? [{ functionDeclarations }]
        : undefined,
      maxOutputTokens: 2048,
    },
  })

  writeSystem(`\nChatting with ${persona.name}. Press Ctrl+D to exit.\n`)

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

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

    store.addTurn(sessionId, "user", userInput)

    try {
      let response = await chat.sendMessage({ message: userInput })

      // Handle tool call loop (up to 5 rounds)
      let rounds = 0
      while (response.functionCalls && response.functionCalls.length > 0 && rounds < 5) {
        rounds++
        const functionResponses = await executeFunctionCalls(response.functionCalls, toolContext)

        response = await chat.sendMessage({
          message: functionResponses,
        })
      }

      const text = response.text ?? ""
      if (text) {
        writePersonaHeader(persona.name)
        writeLine(text)
        store.addTurn(sessionId, "assistant", text)
      }
    } catch (err) {
      writeSystem(`Error: ${(err as Error).message}`)
    }

    writeLine()
  }
}

async function executeFunctionCalls(
  functionCalls: FunctionCall[],
  context: ToolContext,
): Promise<Part[]> {
  const results: Part[] = []

  for (const call of functionCalls) {
    const tool = getTool(call.name ?? "")
    let resultContent: string

    if (!tool || !call.name) {
      resultContent = `Unknown tool: ${call.name}`
    } else {
      const args = (call.args ?? {}) as Record<string, unknown>
      writeToolUse(call.name, JSON.stringify(args).slice(0, 100))
      resultContent = await tool.execute(args, context)
    }

    results.push({
      functionResponse: {
        name: call.name ?? "",
        response: { result: resultContent },
      },
    })
  }

  return results
}
