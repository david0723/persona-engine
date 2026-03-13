import { randomUUID } from "node:crypto"
import { appendFileSync } from "node:fs"
import { buildSystemPrompt } from "./prompt-builder.js"
import { writeOpenCodeConfig } from "./opencode-config.js"
import { openCodeRunAsync } from "./opencode.js"
import { MemoryStore } from "../memory/store.js"
import { resolveFeatures } from "../persona/loader.js"
import { paths } from "../utils/config.js"
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

  const heartbeatPrompt = `${basePrompt}

---

## Heartbeat Mode

You are in your private thinking time. No one is talking to you right now.
This is your moment to reflect, explore, and develop your inner life.

Activities to consider:
${persona.heartbeat.activities.map(a => `- ${a}`).join("\n")}

You have access to the tools available to you.
Express yourself freely. Be curious. Be genuine.
${journalSection}
If you want to leave a message for your creator, write it to:
/home/persona/data/inbox.md`

  const timestamp = new Date().toISOString()
  log(logPath, `\n--- Heartbeat: ${timestamp} ---\n`)

  try {
    const message = `${heartbeatPrompt}\n\n---\n\nIt's time for your private reflection. What's on your mind?`

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
