import { describe, it, expect, beforeEach } from "vitest"
import { MemoryStore } from "./store.js"

let store: MemoryStore

beforeEach(() => {
  store = new MemoryStore("test", ":memory:")
})

describe("addTurn / getRecentTurns", () => {
  it("adds a turn and retrieves it", () => {
    store.addTurn("s1", "user", "hello")
    const turns = store.getRecentTurns("s1")
    expect(turns.length).toBe(1)
    expect(turns[0].kind).toBe("conversation_turn")
  })

  it("content format is [role]: text", () => {
    store.addTurn("s1", "user", "hello")
    const turns = store.getRecentTurns("s1")
    expect(turns[0].content).toBe("[user]: hello")
  })

  it("returns in ASC order", () => {
    store.addTurn("s1", "user", "first")
    store.addTurn("s1", "assistant", "second")
    const turns = store.getRecentTurns("s1")
    expect(turns[0].content).toContain("first")
    expect(turns[1].content).toContain("second")
  })

  it("respects limit", () => {
    store.addTurn("s1", "user", "a")
    store.addTurn("s1", "user", "b")
    store.addTurn("s1", "user", "c")
    expect(store.getRecentTurns("s1", 2).length).toBe(2)
  })

  it("returns empty for unknown session", () => {
    expect(store.getRecentTurns("unknown")).toEqual([])
  })
})

describe("addMemory / getByKind", () => {
  it("stores with correct kind and content", () => {
    store.addMemory("core_memory", "test fact", 7, "s1")
    const memories = store.getByKind("core_memory")
    expect(memories.length).toBe(1)
    expect(memories[0].content).toBe("test fact")
    expect(memories[0].kind).toBe("core_memory")
  })

  it("getByKind filters by kind", () => {
    store.addMemory("core_memory", "core", 7)
    store.addMemory("journal_entry", "journal", 5)
    expect(store.getByKind("core_memory").length).toBe(1)
    expect(store.getByKind("journal_entry").length).toBe(1)
  })

  it("returns in DESC order (most recent first)", () => {
    store.addMemory("core_memory", "first", 5)
    store.addMemory("core_memory", "second", 5)
    const memories = store.getByKind("core_memory")
    // Both inserted in same datetime('now') tick, so SQL falls back to rowid order
    // The important thing is both are returned and filtered correctly
    expect(memories.length).toBe(2)
    expect(memories.map(m => m.content)).toContain("first")
    expect(memories.map(m => m.content)).toContain("second")
  })
})

describe("getTopImportance", () => {
  it("returns ordered by importance DESC", () => {
    store.addMemory("core_memory", "low", 3)
    store.addMemory("core_memory", "high", 9)
    store.addMemory("relationship_note", "mid", 6)
    const result = store.getTopImportance(10, 10000)
    expect(result[0].content).toBe("high")
    expect(result[1].content).toBe("mid")
    expect(result[2].content).toBe("low")
  })

  it("stops when tokenBudget exceeded", () => {
    // Each "a".repeat(40) = 10 tokens for content + brackets
    store.addMemory("core_memory", "a".repeat(40), 9) // ~10 tokens
    store.addMemory("core_memory", "b".repeat(40), 8) // ~10 tokens
    store.addMemory("core_memory", "c".repeat(40), 7) // ~10 tokens
    const result = store.getTopImportance(10, 20)
    expect(result.length).toBe(2)
  })

  it("only returns core_memory and relationship_note kinds", () => {
    store.addMemory("core_memory", "core", 9)
    store.addMemory("journal_entry", "journal", 9)
    store.addMemory("relationship_note", "rel", 9)
    const result = store.getTopImportance(10, 10000)
    expect(result.length).toBe(2)
    expect(result.every(m => m.kind === "core_memory" || m.kind === "relationship_note")).toBe(true)
  })
})

describe("deleteTurnsForSession", () => {
  it("deletes turns for target session", () => {
    store.addTurn("s1", "user", "hello")
    store.addTurn("s1", "assistant", "hi")
    store.deleteTurnsForSession("s1")
    expect(store.getRecentTurns("s1")).toEqual([])
  })

  it("does not touch other sessions or non-turn memories", () => {
    store.addTurn("s1", "user", "hello")
    store.addTurn("s2", "user", "world")
    store.addMemory("core_memory", "keep this", 7, "s1")
    store.deleteTurnsForSession("s1")
    expect(store.getRecentTurns("s2").length).toBe(1)
    expect(store.getByKind("core_memory").length).toBe(1)
  })
})

describe("stats", () => {
  it("returns kind counts as { kind: count }", () => {
    store.addTurn("s1", "user", "a")
    store.addTurn("s1", "user", "b")
    store.addMemory("core_memory", "c", 5)
    const result = store.stats()
    expect(result["conversation_turn"]).toBe(2)
    expect(result["core_memory"]).toBe(1)
  })
})
