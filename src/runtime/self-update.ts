import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { paths } from "../utils/config.js"
import { isContainerized } from "./container.js"
import { sendMessage } from "../telegram/bot.js"
import type { PersonaDefinition } from "../persona/schema.js"

interface RestartSignal {
  action: "restart"
  commit: string
  reason: string
  timestamp: string
}

function signalsDir(): string {
  if (isContainerized()) {
    // Inside the container, the persona-data volume is at ~/.persona-engine
    return join(paths.home, "signals")
  }
  // On host, use the same path
  return join(paths.home, "signals")
}

export async function requestRestart(
  persona: PersonaDefinition,
  reason: string,
  commit?: string,
): Promise<void> {
  const dir = signalsDir()
  mkdirSync(dir, { recursive: true })

  const signal: RestartSignal = {
    action: "restart",
    commit: commit ?? "unknown",
    reason,
    timestamp: new Date().toISOString(),
  }

  const signalPath = join(dir, "restart.json")
  writeFileSync(signalPath, JSON.stringify(signal, null, 2), "utf-8")

  // Notify via Telegram if configured
  if (persona.telegram?.enabled && persona.telegram.bot_token) {
    const chatIds = persona.telegram.allowed_chat_ids ?? []
    for (const chatId of chatIds) {
      try {
        await sendMessage(
          persona.telegram.bot_token,
          chatId,
          `Restarting to apply changes: ${reason}`,
        )
      } catch {
        // Best effort notification
      }
    }
  }
}
