import { describe, it, expect } from "vitest"
import { parseUpdate, splitMessage } from "./bot.js"

describe("parseUpdate", () => {
  it("extracts chatId, text, messageId, from from well-formed update", () => {
    const result = parseUpdate({
      message: {
        chat: { id: 123 },
        text: "hello",
        message_id: 456,
        from: { first_name: "Alice" },
      },
    })
    expect(result).toEqual({
      chatId: 123,
      text: "hello",
      messageId: 456,
      from: "Alice",
    })
  })

  it("returns null when body.message is undefined", () => {
    expect(parseUpdate({})).toBeNull()
  })

  it("returns null when message.text is undefined (photo message)", () => {
    expect(parseUpdate({ message: { chat: { id: 1 }, message_id: 1 } })).toBeNull()
  })

  it('sets from to "Unknown" when message.from is missing', () => {
    const result = parseUpdate({
      message: {
        chat: { id: 1 },
        text: "hi",
        message_id: 1,
      },
    })
    expect(result!.from).toBe("Unknown")
  })
})

describe("splitMessage", () => {
  it("returns single chunk when text fits", () => {
    expect(splitMessage("short", 100)).toEqual(["short"])
  })

  it("splits at newline boundary when possible", () => {
    const text = "line1\nline2\nline3"
    const chunks = splitMessage(text, 11)
    expect(chunks[0]).toBe("line1\nline2")
    expect(chunks.length).toBe(2)
  })

  it("falls back to maxLen hard split when no good newline exists", () => {
    const text = "a".repeat(20)
    const chunks = splitMessage(text, 10)
    expect(chunks[0]).toBe("a".repeat(10))
    expect(chunks[1]).toBe("a".repeat(10))
  })

  it("handles text exactly at maxLen", () => {
    const text = "a".repeat(10)
    expect(splitMessage(text, 10)).toEqual([text])
  })

  it("handles empty string", () => {
    expect(splitMessage("", 100)).toEqual([""])
  })
})
