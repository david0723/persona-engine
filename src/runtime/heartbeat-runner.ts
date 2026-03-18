import { randomUUID } from "node:crypto"
import { appendFileSync } from "node:fs"
import { buildSystemPrompt } from "./prompt-builder.js"
import { writeOpenCodeConfig } from "./opencode-config.js"
import { openCodeRunAsync } from "./opencode.js"
import { MemoryStore } from "../memory/store.js"
import { resolveFeatures } from "../persona/loader.js"
import { paths } from "../utils/config.js"
import { sendMessage } from "../telegram/bot.js"
import { createMetricsLogger } from "../vault/metrics.js"
import type { PersonaDefinition } from "../persona/schema.js"

export async function runHeartbeat(persona: PersonaDefinition): Promise<void> {
  const store = new MemoryStore(persona.name)
  const sessionId = `heartbeat-${randomUUID()}`
  const logPath = paths.heartbeatLog(persona.name)

  // Write scoped opencode.json for this persona
  writeOpenCodeConfig(persona)

  const features = resolveFeatures(persona.features)
  const basePrompt = buildSystemPrompt(persona, store)

  const journalSection = features.journal
    ? `\nWrite your reflections and any important thoughts to:\n/home/persona/data/journal.md\n`
    : ""

  const activitiesList = persona.heartbeat.activities.map(a => `- ${a}`).join("\n")

  let heartbeatSection: string
  if (persona.heartbeat.prompt) {
    heartbeatSection = persona.heartbeat.prompt.replace(/\{activities\}/g, activitiesList)
  } else {
    heartbeatSection = `## Heartbeat Mode

You are in your private thinking time. No one is talking to you right now.
This is your moment to reflect, explore, and develop your inner life.

Activities to consider:
${activitiesList}

You have access to the tools available to you.
Express yourself freely. Be curious. Be genuine.
${journalSection}
If you want to leave a message for your creator, write it to:
/home/persona/data/inbox.md`
  }

  const heartbeatPrompt = `${basePrompt}\n\n---\n\n${heartbeatSection}`

  const vaultPath = persona.vault?.enabled ? persona.vault.path : undefined
  const metrics = createMetricsLogger(vaultPath)

  const timestamp = new Date().toISOString()
  log(logPath, `\n--- Heartbeat: ${timestamp} ---\n`)

  const startTime = Date.now()
  try {
    const kickoff = persona.heartbeat.prompt
      ? "Execute your heartbeat tasks now."
      : "It's time for your private reflection. What's on your mind?"

    const message = `${heartbeatPrompt}\n\n---\n\n${kickoff}`

    const output = await openCodeRunAsync({
      message,
      persona,
      dir: paths.personaDir(persona.name),
      title: `heartbeat-${persona.name}-${sessionId.slice(0, 8)}`,
    })

    log(logPath, output)

    if (output.trim() && features.journal) {
      store.addMemory("journal_entry", `[Heartbeat reflection] ${output.trim().slice(0, 2000)}`, 6, sessionId)
    }

    // Determine notification mode
    const notifyMode = typeof persona.heartbeat.notify === "string"
      ? persona.heartbeat.notify
      : persona.heartbeat.notify ? "telegram" : "silent"

    // Proactive Telegram notification
    if (notifyMode === "telegram" && output.trim() && persona.telegram?.enabled && persona.telegram.bot_token) {
      const truncated = output.trim().slice(0, 4000)
      const chatIds = persona.telegram.allowed_chat_ids ?? []
      for (const chatId of chatIds) {
        try {
          await sendMessage(persona.telegram.bot_token, chatId, truncated)
        } catch (err) {
          log(logPath, `Telegram notify error (chat ${chatId}): ${(err as Error).message}`)
        }
      }
    }

    log(logPath, `--- End heartbeat ---\n`)
    metrics?.logHeartbeat("ok", Date.now() - startTime)
  } catch (err) {
    log(logPath, `ERROR: ${(err as Error).message}`)
    metrics?.logHeartbeat("error", Date.now() - startTime, (err as Error).message)
  } finally {
    store.close()
  }
}

function log(path: string, message: string): void {
  appendFileSync(path, message + "\n", "utf-8")
  console.log(message)
}
