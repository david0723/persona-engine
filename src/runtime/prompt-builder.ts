import { estimateTokens, DEFAULT_BUDGET } from "../utils/token-budget.js"
import { resolveFeatures } from "../persona/loader.js"
import type { PersonaDefinition } from "../persona/schema.js"
import type { MemoryStore } from "../memory/store.js"
import type { Memory } from "../memory/types.js"

export function buildSystemPrompt(persona: PersonaDefinition, store: MemoryStore): string {
  const features = resolveFeatures(persona.features)
  const sections: string[] = []

  // Layer 1: Identity
  if (features.identity && persona.identity) {
    sections.push(buildIdentityLayer(persona))
  } else {
    sections.push(`You are ${persona.name}.`)
  }

  // Layer 2: Core memories + relationship notes
  if (features.memory) {
    const coreMemories = store.getTopImportance(20, DEFAULT_BUDGET.coreMemories)
    if (coreMemories.length > 0) {
      sections.push(buildMemoryLayer(coreMemories))
    }
  }

  // Layer 3: Recent journal entries
  if (features.journal) {
    const journals = store.getByKind("journal_entry", 5)
    if (journals.length > 0) {
      sections.push(buildJournalLayer(journals))
    }
  }

  // Layer 4: Conversation summaries
  if (features.conversation_summary) {
    const summaries = store.getByKind("conversation_summary", 3)
    if (summaries.length > 0) {
      sections.push(buildSummaryLayer(summaries))
    }
  }

  return sections.join("\n\n---\n\n")
}

function buildIdentityLayer(persona: PersonaDefinition): string {
  return `You are ${persona.name}. ${persona.identity!.role}

Your speaking style: ${persona.identity!.speaking_style}
Your core values: ${persona.identity!.values.join(", ")}

${persona.backstory!.trim()}

${persona.instructions!.trim()}`
}

function buildMemoryLayer(memories: Memory[]): string {
  const coreMemories = memories.filter(m => m.kind === "core_memory")
  const relationshipNotes = memories.filter(m => m.kind === "relationship_note")

  const parts: string[] = ["## What you remember"]

  if (coreMemories.length > 0) {
    parts.push(coreMemories.map(m => `- ${m.content}`).join("\n"))
  }

  if (relationshipNotes.length > 0) {
    parts.push("\n## What you know about the people you've met")
    parts.push(relationshipNotes.map(m => `- ${m.content}`).join("\n"))
  }

  return parts.join("\n")
}

function buildJournalLayer(journals: Memory[]): string {
  const entries = journals.map(j => {
    const date = new Date(j.created_at).toLocaleDateString()
    return `[${date}] ${j.content}`
  })

  return `## Your recent journal entries\n${entries.join("\n\n")}`
}

function buildSummaryLayer(summaries: Memory[]): string {
  const entries = summaries.map(s => {
    const date = new Date(s.created_at).toLocaleDateString()
    return `[${date}] ${s.content}`
  })

  return `## Previous conversations\n${entries.join("\n\n")}`
}

export function trimTurnsToFit(
  turns: Array<{ role: string; content: string }>,
  maxTokens: number = DEFAULT_BUDGET.currentSession
): Array<{ role: string; content: string }> {
  let totalTokens = turns.reduce((sum, t) => sum + estimateTokens(t.content), 0)

  const trimmed = [...turns]
  while (totalTokens > maxTokens && trimmed.length > 2) {
    const removed = trimmed.shift()!
    totalTokens -= estimateTokens(removed.content)
  }

  return trimmed
}
