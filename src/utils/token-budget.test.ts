import { describe, it, expect } from "vitest"
import { estimateTokens } from "./token-budget.js"

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0)
  })

  it("returns 1 for 4-char string", () => {
    expect(estimateTokens("abcd")).toBe(1)
  })

  it("returns 2 for 5-char string (ceil)", () => {
    expect(estimateTokens("abcde")).toBe(2)
  })

  it("returns 250 for 1000-char string", () => {
    expect(estimateTokens("a".repeat(1000))).toBe(250)
  })
})
