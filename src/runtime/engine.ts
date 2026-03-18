import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { buildSystemPrompt } from "./prompt-builder.js"
import { writeOpenCodeConfig } from "./opencode-config.js"
import { openCodeRunStreaming } from "./opencode.js"
import { OpenCodeSessionClient, SessionManager } from "./opencode-session.js"
import { MemoryStore } from "../memory/store.js"
import { summarizeSession } from "../memory/summarizer.js"
import { resolveFeatures } from "../persona/loader.js"
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

// Stderr patterns that are noise, not real errors
const STDERR_NOISE_PATTERNS = [
  /sqlite-migration:done/,
  /const provider = s\.providers/,
  /s\.providers\[providerID\]/,
  /^\s+at /,               // stack trace lines
  /\d{3,}\s*\|/,           // source code line numbers (e.g. "1175 |")
  /^Downloading/,          // download progress
  /^Extracting/,
]

const recentStderr = new Map<string, number>()
const DEDUP_WINDOW_MS = 5000

function isSignificantError(text: string): boolean {
  // Filter known noise patterns
  for (const pattern of STDERR_NOISE_PATTERNS) {
    if (pattern.test(text)) return false
  }

  // Deduplicate rapid repeats
  const key = text.slice(0, 80)
  const now = Date.now()
  const lastSeen = recentStderr.get(key)
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return false
  recentStderr.set(key, now)

  // Prune old entries periodically
  if (recentStderr.size > 100) {
    for (const [k, ts] of recentStderr) {
      if (now - ts > DEDUP_WINDOW_MS) recentStderr.delete(k)
    }
  }

  return true
}

// Patterns that indicate tool usage in opencode output
const TOOL_PATTERNS = [
  /^⏺ (Read|Write|Edit|Bash|Glob|Grep|Search|WebFetch|WebSearch|ListMcpResourcesTool|Agent)\b/m,
  /^⏺ (\S+)\(/m,
]

/** Key for session routing based on message source */
function sourceKey(source: MessageSource): string {
  if (source.type === "telegram") return `telegram:${source.chatId}`
  if (source.type === "attach") return "attach"
  return "cli"
}

export class ConversationEngine extends EventEmitter {
  private store: MemoryStore
  private sessionId: string
  private isFirstMessage = true
  private queue: QueuedMessage[] = []
  private processing = false
  private _attachUrl?: string
  private sessionClient?: OpenCodeSessionClient
  private sessionManager?: SessionManager

  constructor(public readonly persona: PersonaDefinition) {
    super()
    this.store = new MemoryStore(persona.name)
    this.sessionId = randomUUID()
    writeOpenCodeConfig(persona)
  }

  get attachUrl(): string | undefined {
    return this._attachUrl
  }

  set attachUrl(url: string | undefined) {
    this._attachUrl = url
    // When serve URL is set, create session client for HTTP API
    if (url) {
      this.sessionClient = new OpenCodeSessionClient(url)
      this.sessionManager = new SessionManager(this.sessionClient)
      console.log(`Session API enabled at ${url}`)
    } else {
      this.sessionClient = undefined
      this.sessionManager = undefined
    }
  }

  get memoryStore(): MemoryStore {
    return this.store
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
    const features = resolveFeatures(this.persona.features)

    if (features.conversation_summary) {
      const turns = this.store.getTurnsBySession(this.sessionId)
      if (turns.length >= 2) {
        await summarizeSession(this.sessionId, this.store, this.persona)
      }
    }

    // Clean up HTTP sessions
    if (this.sessionManager) {
      await this.sessionManager.cleanup()
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

    // Try HTTP Session API first (when opencode serve is running)
    if (this.sessionClient && this.sessionManager) {
      try {
        const healthy = await this.sessionClient.isHealthy()
        if (healthy) {
          return await this.processViaSessionApi(taggedText, source)
        }
      } catch {
        // Fall through to CLI mode
        console.log("Session API unavailable, falling back to CLI")
      }
    }

    // Fallback: CLI mode (opencode run)
    return this.processViaCli(taggedText, source)
  }

  /**
   * Process message via the OpenCode HTTP Session API.
   * Maintains per-source sessions with conversation continuity.
   */
  private async processViaSessionApi(taggedText: string, source: MessageSource): Promise<string> {
    const key = sourceKey(source)
    const sessionId = await this.sessionManager!.getOrCreateSession(
      key,
      `persona-${this.persona.name}-${key}`,
    )

    this.emit("thinking", { source })

    // For the first message in a new session, include the system prompt
    const isNewSession = !this.sessionManager!["sessions"].get(key) ||
      Date.now() - this.sessionManager!["sessions"].get(key)!.lastActivity < 1000

    let messageText = taggedText
    if (isNewSession) {
      const systemPrompt = buildSystemPrompt(this.persona, this.store)
      messageText = `${systemPrompt}\n\n---\n\nThe user says: ${taggedText}`
    }

    const result = await this.sessionClient!.sendMessage(sessionId, messageText, {
      model: this.persona.model,
    })

    this.emit("responding", { source })

    const trimmed = result.text.trim()
    if (trimmed) {
      this.store.addTurn(this.sessionId, "assistant", trimmed, source.type)
      this.emit("response", { source, role: "assistant", text: trimmed } satisfies ConversationEvent)
    }

    return trimmed
  }

  /**
   * Process message via CLI (opencode run).
   * Original path - used when opencode serve is not available.
   */
  private async processViaCli(taggedText: string, source: MessageSource): Promise<string> {
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
      attachUrl: this._attachUrl,
    }

    // Always use streaming so we can emit activity events
    this.emit("thinking", { source })
    let lastActivity = ""

    const output = await openCodeRunStreaming(
      runOptions,
      () => this.emit("responding", { source }),
      (chunk) => {
        this.emit("chunk", chunk)

        // Detect tool calls in the output
        for (const pattern of TOOL_PATTERNS) {
          const match = chunk.match(pattern)
          if (match && match[1] !== lastActivity) {
            lastActivity = match[1]
            this.emit("activity", { source, tool: match[1] })
          }
        }
      },
      (stderrText) => {
        if (isSignificantError(stderrText)) {
          this.emit("stderr", { source, text: stderrText.slice(0, 120) })
        }
      },
    )

    const trimmed = output.trim()
    if (trimmed) {
      this.store.addTurn(this.sessionId, "assistant", trimmed, source.type)
      this.emit("response", { source, role: "assistant", text: trimmed } satisfies ConversationEvent)
    }

    return trimmed
  }
}
