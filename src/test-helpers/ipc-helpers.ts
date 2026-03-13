import { EventEmitter } from "node:events"

interface Turn {
  role: string
  text: string
  source: string
  created_at: string
}

export interface FakeEngine extends EventEmitter {
  getRecentTurns(limit?: number): Turn[]
  handleMessage(text: string, source: { type: string }): Promise<string>
  lastMessage: { text: string; source: { type: string } } | null
}

export function createFakeEngine(turns: Turn[] = []): FakeEngine {
  const emitter = new EventEmitter() as FakeEngine

  emitter.lastMessage = null

  emitter.getRecentTurns = (limit?: number) => {
    return limit ? turns.slice(-limit) : turns
  }

  emitter.handleMessage = async (text: string, source: { type: string }) => {
    emitter.lastMessage = { text, source }
    const response = `Reply to: ${text}`
    emitter.emit("response", { source, role: "assistant", text: response })
    return response
  }

  return emitter
}
