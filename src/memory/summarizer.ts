import Anthropic from "@anthropic-ai/sdk"
import type { MemoryStore } from "./store.js"

const SUMMARY_MODEL = "claude-haiku-4-5-20251001"

export async function summarizeSession(sessionId: string, store: MemoryStore): Promise<void> {
  const turns = store.getTurnsBySession(sessionId)
  if (turns.length < 2) return

  const conversationText = turns.map(t => t.content).join("\n")

  const client = new Anthropic()

  const response = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 1024,
    system: `You are a memory summarizer. Given a conversation, produce:
1. A 2-3 paragraph summary of what was discussed, key moments, and emotional tone.
2. Any important facts about the user that should be remembered (format each as a separate line starting with "RELATIONSHIP: ").
3. Any important realizations or personality developments (format each as "CORE: ").

Be concise but capture the essence of the interaction.`,
    messages: [
      {
        role: "user",
        content: `Summarize this conversation:\n\n${conversationText}`,
      },
    ],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""

  // Extract and store structured memories
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

  // Store the summary
  const summary = summaryLines.join("\n").trim()
  if (summary) {
    store.addMemory("conversation_summary", summary, 5, sessionId)
  }

  // Prune raw turns for this session (keep summaries)
  store.deleteTurnsForSession(sessionId)
}
