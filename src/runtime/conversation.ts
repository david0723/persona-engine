import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import { buildSystemPrompt } from "./prompt-builder.js"
import { writeOpenCodeConfig } from "./opencode-config.js"
import { openCodeRunStreaming } from "./opencode.js"
import { MemoryStore } from "../memory/store.js"
import { summarizeSession } from "../memory/summarizer.js"
import { writeLine, writeUserPrompt, writeSystem } from "../utils/stream.js"
import { paths } from "../utils/config.js"
import type { PersonaDefinition } from "../persona/schema.js"

export async function startChat(persona: PersonaDefinition): Promise<void> {
  const store = new MemoryStore(persona.name)
  const sessionId = randomUUID()
  let isFirstMessage = true

  // Write scoped opencode.json for this persona
  writeOpenCodeConfig(persona)

  const mode = persona.container?.enabled ? "container" : "host"
  writeSystem(`\nChatting with ${persona.name} (via Open Code, ${mode} mode). Press Ctrl+D to exit.\n`)

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  const cleanup = async () => {
    writeSystem("\n\nSaving memories...")
    const turns = store.getTurnsBySession(sessionId)
    if (turns.length >= 2) {
      await summarizeSession(sessionId, store, persona)
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
      let message: string

      if (isFirstMessage) {
        const systemPrompt = buildSystemPrompt(persona, store)
        message = `${systemPrompt}\n\n---\n\nThe user says: ${userInput}`
        isFirstMessage = false
      } else {
        message = userInput
      }

      writeLine()
      const output = await openCodeRunStreaming({
        message,
        persona,
        dir: paths.personaDir(persona.name),
        title: `persona-${persona.name}`,
      })

      const trimmedOutput = output.trim()
      if (trimmedOutput) {
        store.addTurn(sessionId, "assistant", trimmedOutput)
      }
    } catch (err) {
      writeSystem(`Error: ${(err as Error).message}`)
    }

    writeLine()
  }
}
