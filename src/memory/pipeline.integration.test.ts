import { describe, it, expect, beforeEach } from "vitest"
import { MemoryStore } from "./store.js"
import { buildSystemPrompt } from "../runtime/prompt-builder.js"
import { makePersona } from "../test-helpers/fixtures.js"
import type { PersonaDefinition } from "../persona/schema.js"

let store: MemoryStore
let persona: PersonaDefinition

beforeEach(() => {
  store = new MemoryStore("test", ":memory:")
  persona = makePersona()
})

describe("memory -> prompt pipeline", () => {
  describe("store -> prompt builder", () => {
    it("core memories appear in prompt under 'What you remember'", () => {
      store.addMemory("core_memory", "I love cats", 8)
      store.addMemory("core_memory", "My favorite color is blue", 7)

      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).toContain("What you remember")
      expect(prompt).toContain("I love cats")
      expect(prompt).toContain("My favorite color is blue")
    })

    it("relationship notes appear under 'people you've met'", () => {
      store.addMemory("relationship_note", "Alice is a software engineer who loves Rust", 8)

      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).toContain("people you've met")
      expect(prompt).toContain("Alice is a software engineer who loves Rust")
    })

    it("journal entries appear under 'recent journal entries'", () => {
      store.addMemory("journal_entry", "Today I learned about integration testing.", 5)

      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).toContain("recent journal entries")
      expect(prompt).toContain("Today I learned about integration testing.")
    })

    it("conversation summaries appear under 'Previous conversations'", () => {
      store.addMemory("conversation_summary", "Discussed project architecture and testing strategy.", 5)

      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).toContain("Previous conversations")
      expect(prompt).toContain("Discussed project architecture and testing strategy.")
    })

    it("token budget limits memories included in prompt", () => {
      // Add many core memories that exceed the budget
      for (let i = 0; i < 100; i++) {
        store.addMemory("core_memory", `Memory entry number ${i}: ${"x".repeat(200)}`, 8)
      }

      const prompt = buildSystemPrompt(persona, store)
      // Not all 100 memories should be in the prompt due to token budget
      const memoryCount = (prompt.match(/Memory entry number/g) || []).length
      expect(memoryCount).toBeLessThan(100)
      expect(memoryCount).toBeGreaterThan(0)
    })
  })

  describe("feature flags", () => {
    it("identity=false uses minimal 'You are {name}.' fallback", () => {
      persona = makePersona({ features: { identity: false, memory: true, journal: true, conversation_summary: true } })
      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).toContain("You are test-persona.")
      expect(prompt).not.toContain("speaking style")
    })

    it("memory=false excludes core memories and relationships", () => {
      store.addMemory("core_memory", "Should not appear", 8)
      store.addMemory("relationship_note", "Also should not appear", 8)

      persona = makePersona({ features: { identity: true, memory: false, journal: true, conversation_summary: true } })
      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).not.toContain("Should not appear")
      expect(prompt).not.toContain("Also should not appear")
      expect(prompt).not.toContain("What you remember")
    })

    it("journal=false excludes journal entries", () => {
      store.addMemory("journal_entry", "Secret journal entry", 5)

      persona = makePersona({ features: { identity: true, memory: true, journal: false, conversation_summary: true } })
      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).not.toContain("Secret journal entry")
      expect(prompt).not.toContain("recent journal entries")
    })

    it("conversation_summary=false excludes summaries", () => {
      store.addMemory("conversation_summary", "Previous conversation details", 5)

      persona = makePersona({ features: { identity: true, memory: true, journal: true, conversation_summary: false } })
      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).not.toContain("Previous conversation details")
      expect(prompt).not.toContain("Previous conversations")
    })

    it("all features disabled produces minimal prompt", () => {
      store.addMemory("core_memory", "hidden", 8)
      store.addMemory("journal_entry", "hidden", 5)
      store.addMemory("conversation_summary", "hidden", 5)

      persona = makePersona({ features: { identity: false, memory: false, journal: false, conversation_summary: false } })
      const prompt = buildSystemPrompt(persona, store)
      expect(prompt).toBe("You are test-persona.")
    })
  })
})
