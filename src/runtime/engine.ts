import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { buildSystemPrompt } from "./prompt-builder.js"
import { writeOpenCodeConfig } from "./opencode-config.js"
import { openCodeRun, openCodeRunStreaming } from "./opencode.js"
import { MemoryStore } from "../memory/store.js"
import { summarizeSession } from "../memory/summarizer.js"
import { paths } from "../utils/config.js"
import type { PersonaDefinition } from "../persona/schema.js"

export type MessageSource =
  | { type: "cli" }
  | { type: "telegram"; chatId: number }
  | { type: "attach" }

interface QueuedMessage {
  text: string
  source: MessageSource
  resolve: (response: string) => void
  reject: (error: Error) => void
}

export interface ConversationEvent {
  source: MessageSource
  role: "user" | "assistant"
  text: string
}

export class ConversationEngine extends EventEmitter {
  private store: MemoryStore
  private sessionId: string
  private isFirstMessage = true
  private queue: QueuedMessage[] = []
  private processing = false

  constructor(public readonly persona: PersonaDefinition) {
    super()
    this.store = new MemoryStore(persona.name)
    this.sessionId = randomUUID()
    writeOpenCodeConfig(persona)
  }

  async handleMessage(text: string, source: MessageSource): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, source, resolve, reject })
      this.processQueue()
    })
  }

  getRecentTurns(limit: number = 30): { role: string; text: string; source: string; created_at: string }[] {
    const turns = this.store.getRecentTurns(this.sessionId, limit)
    return turns.map((t) => {
      // Content format is "[role]: text"
      const match = t.content.match(/^\[(user|assistant)\]: (.*)$/s)
      return {
        role: match?.[1] ?? "user",
        text: match?.[2] ?? t.content,
        source: t.session_id ? "cli" : "unknown",
        created_at: t.created_at,
      }
    })
  }

  async shutdown(): Promise<void> {
    const turns = this.store.getTurnsBySession(this.sessionId)
    if (turns.length >= 2) {
      await summarizeSession(this.sessionId, this.store, this.persona)
    }
    this.store.close()
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      try {
        const response = await this.processMessage(item.text, item.source)
        item.resolve(response)
      } catch (err) {
        item.reject(err as Error)
      }
    }

    this.processing = false
  }

  private async processMessage(text: string, source: MessageSource): Promise<string> {
    // Tag message with source
    const sourceTag =
      source.type === "telegram" ? "[sent from phone] " :
      source.type === "attach" ? "[sent from attached terminal] " : ""
    const taggedText = `${sourceTag}${text}`

    this.store.addTurn(this.sessionId, "user", taggedText, source.type)
    this.emit("message", { source, role: "user", text } satisfies ConversationEvent)

    // Build the message for opencode
    let message: string
    if (this.isFirstMessage) {
      const systemPrompt = buildSystemPrompt(this.persona, this.store)
      message = `${systemPrompt}\n\n---\n\nThe user says: ${taggedText}`
      this.isFirstMessage = false
    } else {
      message = taggedText
    }

    const dir = paths.personaDir(this.persona.name)
    const runOptions = {
      message,
      persona: this.persona,
      dir,
      continueSession: !this.isFirstMessage,
      title: `persona-${this.persona.name}`,
      model: this.persona.model,
    }

    // Use streaming for CLI and attach, non-streaming for Telegram
    this.emit("thinking", { source })
    let output: string
    if (source.type === "cli" || source.type === "attach") {
      output = await openCodeRunStreaming(
        runOptions,
        () => this.emit("responding", { source }),
        (chunk) => this.emit("chunk", chunk),
      )
    } else {
      output = openCodeRun(runOptions)
    }

    const trimmed = output.trim()
    if (trimmed) {
      this.store.addTurn(this.sessionId, "assistant", trimmed, source.type)
      this.emit("response", { source, role: "assistant", text: trimmed } satisfies ConversationEvent)
    }

    return trimmed
  }
}
