import { describe, it, expect } from "vitest"
import { trimTurnsToFit } from "./prompt-builder.js"

const turn = (content: string) => ({ role: "user", content })

describe("trimTurnsToFit", () => {
  it("returns all turns when total tokens fit within budget", () => {
    const turns = [turn("hi"), turn("hey")]
    expect(trimTurnsToFit(turns, 1000)).toEqual(turns)
  })

  it("removes oldest turns (from front) when over budget", () => {
    const turns = [
      turn("a".repeat(40)), // 10 tokens
      turn("b".repeat(40)), // 10 tokens
      turn("c".repeat(40)), // 10 tokens
    ]
    const result = trimTurnsToFit(turns, 20)
    expect(result.length).toBe(2)
    expect(result[0].content).toBe("b".repeat(40))
    expect(result[1].content).toBe("c".repeat(40))
  })

  it("never removes below 2 turns", () => {
    const turns = [
      turn("a".repeat(100)),
      turn("b".repeat(100)),
      turn("c".repeat(100)),
    ]
    const result = trimTurnsToFit(turns, 1)
    expect(result.length).toBe(2)
  })

  it("single turn exceeding budget still returned", () => {
    const turns = [turn("a".repeat(1000))]
    const result = trimTurnsToFit(turns, 1)
    expect(result.length).toBe(1)
  })

  it("empty array returns empty array", () => {
    expect(trimTurnsToFit([], 1000)).toEqual([])
  })
})
