import { openCodeRun } from "../runtime/opencode.js"
import type { MemoryStore } from "./store.js"
import type { PersonaDefinition } from "../persona/schema.js"

export async function summarizeSession(sessionId: string, store: MemoryStore, persona: PersonaDefinition): Promise<void> {
  const turns = store.getTurnsBySession(sessionId)
  if (turns.length < 2) return

  const conversationText = turns.map(t => t.content).join("\n")

  const prompt = `You are a memory summarizer. Given this conversation, produce:
1. A 2-3 paragraph summary of what was discussed, key moments, and emotional tone.
2. Any important facts about the user (format each as "RELATIONSHIP: <fact>").
3. Any important realizations or personality developments (format each as "CORE: <fact>").

Be concise but capture the essence. Output ONLY the summary and tagged lines, nothing else.

Conversation:

${conversationText}`

  try {
    const text = openCodeRun({ message: prompt, persona })

    const lines = text.split("\n")
    const summaryLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("RELATIONSHIP: ")) {
        store.addMemory("relationship_note", trimmed.slice(14), 7, sessionId)
      } else if (trimmed.startsWith("CORE: ")) {
        store.addMemory("core_memory", trimmed.slice(6), 7, sessionId)
      } else {
        summaryLines.push(line)
      }
    }

    const summary = summaryLines.join("\n").trim()
    if (summary) {
      store.addMemory("conversation_summary", summary, 5, sessionId)
    }
  } catch {
    store.addMemory("conversation_summary", `Session with ${turns.length} turns (summarization failed)`, 3, sessionId)
  }

  store.deleteTurnsForSession(sessionId)
}
