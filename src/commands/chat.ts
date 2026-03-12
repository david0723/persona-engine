import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { startChat } from "../runtime/conversation.js"

export async function chatWithPersona(name: string): Promise<void> {
  try {
    const persona = loadPersona(name)
    await startChat(persona)
  } catch (err) {
    console.error(chalk.red((err as Error).message))
    process.exit(1)
  }
}
