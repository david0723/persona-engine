/**
 * HTTP client for the OpenCode serve REST API.
 * Provides session management and message sending via HTTP
 * instead of spawning `opencode run` CLI processes.
 */

export interface SessionInfo {
  id: string
  title?: string
  parentID?: string
}

export interface MessagePart {
  type: "text" | "thinking" | "tool"
  text?: string
  name?: string
  state?: string
}

export interface MessageResponse {
  info: {
    id: string
    sessionID: string
    role: string
  }
  parts: MessagePart[]
}

export interface SendMessageOptions {
  parts: Array<{ type: "text"; text: string }>
  model?: string
  agent?: string
  system?: string
}

export class OpenCodeSessionClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    // Normalize URL (remove trailing slash)
    this.baseUrl = baseUrl.replace(/\/+$/, "")
  }

  /** Health check - verify serve is running */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return false
      const data = await res.json() as { healthy?: boolean }
      return data.healthy === true
    } catch {
      return false
    }
  }

  /** Create a new session */
  async createSession(title?: string): Promise<SessionInfo> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to create session: ${res.status} ${text}`)
    }

    return res.json() as Promise<SessionInfo>
  }

  /** List all sessions */
  async listSessions(): Promise<SessionInfo[]> {
    const res = await fetch(`${this.baseUrl}/session`)
    if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`)
    return res.json() as Promise<SessionInfo[]>
  }

  /** Delete a session */
  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      method: "DELETE",
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete session: ${res.status}`)
    }
  }

  /** Abort a running session */
  async abortSession(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
      method: "POST",
    }).catch(() => {})
  }

  /**
   * Send a message to a session and wait for the full response.
   * This is synchronous - it blocks until the AI finishes responding.
   */
  async sendMessage(sessionId: string, text: string, options?: {
    model?: string
    agent?: string
    system?: string
  }): Promise<{ text: string; raw: MessageResponse }> {
    const body: SendMessageOptions = {
      parts: [{ type: "text", text }],
      ...options,
    }

    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30 * 60 * 1000), // 30 min hard timeout
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Failed to send message: ${res.status} ${errText}`)
    }

    const data = await res.json() as MessageResponse

    // Extract text from response parts
    const responseText = data.parts
      .filter(p => p.type === "text" && p.text)
      .map(p => p.text!)
      .join("\n")

    return { text: responseText, raw: data }
  }

  /**
   * Send a message asynchronously (fire and forget).
   * Monitor progress via SSE events.
   */
  async sendMessageAsync(sessionId: string, text: string, options?: {
    model?: string
    agent?: string
    system?: string
  }): Promise<void> {
    const body: SendMessageOptions = {
      parts: [{ type: "text", text }],
      ...options,
    }

    const res = await fetch(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Failed to send async message: ${res.status} ${errText}`)
    }
  }

  /** Get messages for a session */
  async getMessages(sessionId: string, limit?: number): Promise<unknown[]> {
    const url = limit
      ? `${this.baseUrl}/session/${sessionId}/message?limit=${limit}`
      : `${this.baseUrl}/session/${sessionId}/message`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to get messages: ${res.status}`)
    return res.json() as Promise<unknown[]>
  }
}

/**
 * Manages session lifecycle: creates sessions per conversation source,
 * handles inactivity timeouts, and cleans up stale sessions.
 */
export class SessionManager {
  private sessions = new Map<string, { sessionId: string; lastActivity: number }>()
  private client: OpenCodeSessionClient
  private inactivityMs: number

  constructor(client: OpenCodeSessionClient, inactivityTimeoutMs = 30 * 60 * 1000) {
    this.client = client
    this.inactivityMs = inactivityTimeoutMs
  }

  /**
   * Get or create a session for a given conversation key.
   * Key is typically "telegram:<chatId>" or "cli".
   */
  async getOrCreateSession(key: string, title?: string): Promise<string> {
    const existing = this.sessions.get(key)

    if (existing) {
      const elapsed = Date.now() - existing.lastActivity
      if (elapsed < this.inactivityMs) {
        // Session still active, update timestamp
        existing.lastActivity = Date.now()
        return existing.sessionId
      }
      // Session expired, clean up
      await this.client.deleteSession(existing.sessionId).catch(() => {})
      this.sessions.delete(key)
    }

    // Create new session
    const session = await this.client.createSession(title ?? `persona-${key}`)
    this.sessions.set(key, {
      sessionId: session.id,
      lastActivity: Date.now(),
    })
    return session.id
  }

  /** Mark a session as active (reset inactivity timer) */
  touch(key: string): void {
    const entry = this.sessions.get(key)
    if (entry) entry.lastActivity = Date.now()
  }

  /** Remove a session */
  async removeSession(key: string): Promise<void> {
    const entry = this.sessions.get(key)
    if (entry) {
      await this.client.deleteSession(entry.sessionId).catch(() => {})
      this.sessions.delete(key)
    }
  }

  /** Clean up all sessions */
  async cleanup(): Promise<void> {
    for (const [key, entry] of this.sessions) {
      await this.client.deleteSession(entry.sessionId).catch(() => {})
    }
    this.sessions.clear()
  }
}
