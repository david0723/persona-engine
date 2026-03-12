import { describe, it, expect } from "vitest"
import { parseSummaryOutput } from "./summarizer.js"

describe("parseSummaryOutput", () => {
  it("extracts RELATIONSHIP: lines with prefix stripped", () => {
    const result = parseSummaryOutput("RELATIONSHIP: likes cats\nRELATIONSHIP: works at Acme")
    expect(result.relationships).toEqual(["likes cats", "works at Acme"])
  })

  it("extracts CORE: lines with prefix stripped", () => {
    const result = parseSummaryOutput("CORE: values honesty\nCORE: growing more patient")
    expect(result.coreMemories).toEqual(["values honesty", "growing more patient"])
  })

  it("remaining lines become summaryText (joined, trimmed)", () => {
    const result = parseSummaryOutput("This was a good chat.\nThey discussed the weather.")
    expect(result.summaryText).toBe("This was a good chat.\nThey discussed the weather.")
    expect(result.relationships).toEqual([])
    expect(result.coreMemories).toEqual([])
  })

  it("mixed input with all three types", () => {
    const input = [
      "The conversation was warm.",
      "RELATIONSHIP: user is a developer",
      "They talked about code.",
      "CORE: becoming more curious",
    ].join("\n")

    const result = parseSummaryOutput(input)
    expect(result.relationships).toEqual(["user is a developer"])
    expect(result.coreMemories).toEqual(["becoming more curious"])
    expect(result.summaryText).toBe("The conversation was warm.\nThey talked about code.")
  })

  it("empty string returns empty arrays and empty summary", () => {
    const result = parseSummaryOutput("")
    expect(result.relationships).toEqual([])
    expect(result.coreMemories).toEqual([])
    expect(result.summaryText).toBe("")
  })

  it('"RELATIONSHIP:" without trailing space does NOT match', () => {
    const result = parseSummaryOutput("RELATIONSHIP:no space")
    expect(result.relationships).toEqual([])
    expect(result.summaryText).toBe("RELATIONSHIP:no space")
  })
})
