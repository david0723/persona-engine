import { openCodeRunAsync } from "../runtime/opencode.js"
import type { MemoryStore } from "./store.js"
import type { PersonaDefinition } from "../persona/schema.js"

export interface ParsedSummary {
  relationships: string[]
  coreMemories: string[]
  summaryText: string
}

export function parseSummaryOutput(text: string): ParsedSummary {
  const lines = text.split("\n")
  const relationships: string[] = []
  const coreMemories: string[] = []
  const summaryLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("RELATIONSHIP: ")) {
      relationships.push(trimmed.slice(14))
    } else if (trimmed.startsWith("CORE: ")) {
      coreMemories.push(trimmed.slice(6))
    } else {
      summaryLines.push(line)
    }
  }

  return {
    relationships,
    coreMemories,
    summaryText: summaryLines.join("\n").trim(),
  }
}

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
    const text = await openCodeRunAsync({ message: prompt, persona })
    const parsed = parseSummaryOutput(text)

    for (const rel of parsed.relationships) {
      store.addMemory("relationship_note", rel, 7, sessionId)
    }
    for (const core of parsed.coreMemories) {
      store.addMemory("core_memory", core, 7, sessionId)
    }

    if (parsed.summaryText) {
      store.addMemory("conversation_summary", parsed.summaryText, 5, sessionId)
    }
  } catch {
    store.addMemory("conversation_summary", `Session with ${turns.length} turns (summarization failed)`, 3, sessionId)
  }

  store.deleteTurnsForSession(sessionId)
}
