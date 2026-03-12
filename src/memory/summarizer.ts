import { GoogleGenAI } from "@google/genai"
import type { MemoryStore } from "./store.js"

const SUMMARY_MODEL = "gemini-2.5-flash"

export async function summarizeSession(sessionId: string, store: MemoryStore): Promise<void> {
  const turns = store.getTurnsBySession(sessionId)
  if (turns.length < 2) return

  const conversationText = turns.map(t => t.content).join("\n")

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

  const response = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    config: {
      systemInstruction: `You are a memory summarizer. Given a conversation, produce:
1. A 2-3 paragraph summary of what was discussed, key moments, and emotional tone.
2. Any important facts about the user that should be remembered (format each as a separate line starting with "RELATIONSHIP: ").
3. Any important realizations or personality developments (format each as "CORE: ").

Be concise but capture the essence of the interaction.`,
      maxOutputTokens: 1024,
    },
    contents: `Summarize this conversation:\n\n${conversationText}`,
  })

  const text = response.text ?? ""

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

  store.deleteTurnsForSession(sessionId)
}
