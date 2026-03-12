import { createInterface } from "node:readline"
import chalk from "chalk"
import { ConversationEngine, type ConversationEvent } from "./engine.js"
import { writeLine, writeUserPrompt, writeSystem } from "../utils/stream.js"
import type { PersonaDefinition } from "../persona/schema.js"

export async function startChat(persona: PersonaDefinition): Promise<void> {
  const engine = new ConversationEngine(persona)

  const mode = persona.container?.enabled ? "container" : "host"
  writeSystem(`\nChatting with ${persona.name} (via Open Code, ${mode} mode). Press Ctrl+D to exit.\n`)

  // Show messages from other sources (e.g., Telegram)
  engine.on("message", (event: ConversationEvent) => {
    if (event.source.type === "telegram" && event.role === "user") {
      writeLine(chalk.dim(`[phone] ${event.text}`))
    }
  })

  return runCliAdapter(engine)
}

export async function runCliAdapter(engine: ConversationEngine): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  const cleanup = async () => {
    writeSystem("\n\nSaving memories...")
    await engine.shutdown()
    writeSystem("Session summarized. Goodbye.\n")
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

    try {
      writeLine()
      await engine.handleMessage(userInput, { type: "cli" })
    } catch (err) {
      writeSystem(`Error: ${(err as Error).message}`)
    }

    writeLine()
  }
}
