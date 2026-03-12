import { createServer, type Server, type Socket } from "node:net"
import { existsSync, unlinkSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { paths } from "../utils/config.js"
import type { ConversationEngine, ConversationEvent, MessageSource } from "./engine.js"

export interface IpcMessage {
  type: "message"
  text: string
}

export interface IpcEvent {
  type: "thinking" | "responding" | "message" | "response" | "history"
  text?: string
  source?: string
  turns?: { role: string; text: string; source: string; timestamp: string }[]
}

export function socketPath(personaName: string): string {
  return `${paths.personaDir(personaName)}/engine.sock`
}

export class IpcServer {
  private server: Server | null = null
  private clients = new Set<Socket>()
  private sockPath: string

  constructor(
    private engine: ConversationEngine,
    personaName: string,
  ) {
    this.sockPath = socketPath(personaName)
  }

  start(): void {
    // Clean up stale socket
    if (existsSync(this.sockPath)) {
      unlinkSync(this.sockPath)
    }

    mkdirSync(dirname(this.sockPath), { recursive: true })

    this.server = createServer((socket) => this.onConnect(socket))
    this.server.listen(this.sockPath)

    // Wire engine events to broadcast
    this.engine.on("thinking", (ev: { source: MessageSource }) => {
      this.broadcast({ type: "thinking", source: ev.source.type })
    })

    this.engine.on("responding", (ev: { source: MessageSource }) => {
      this.broadcast({ type: "responding", source: ev.source.type })
    })

    this.engine.on("message", (ev: ConversationEvent) => {
      this.broadcast({ type: "message", text: ev.text, source: ev.source.type })
    })

    this.engine.on("response", (ev: ConversationEvent) => {
      this.broadcast({ type: "response", text: ev.text, source: ev.source.type })
    })
  }

  stop(): void {
    for (const client of this.clients) {
      client.destroy()
    }
    this.clients.clear()

    if (this.server) {
      this.server.close()
      this.server = null
    }

    if (existsSync(this.sockPath)) {
      unlinkSync(this.sockPath)
    }
  }

  private onConnect(socket: Socket): void {
    this.clients.add(socket)

    // Send recent history
    const turns = this.engine.getRecentTurns(30)
    const history: IpcEvent = {
      type: "history",
      turns: turns.map((t) => ({
        role: t.role,
        text: t.text,
        source: t.source,
        timestamp: t.created_at,
      })),
    }
    this.send(socket, history)

    // Handle incoming messages
    let buffer = ""
    socket.on("data", (data) => {
      buffer += data.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as IpcMessage
          if (msg.type === "message" && msg.text) {
            this.engine
              .handleMessage(msg.text, { type: "attach" })
              .catch((err) => {
                this.send(socket, {
                  type: "response",
                  text: `Error: ${(err as Error).message}`,
                  source: "attach",
                })
              })
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    })

    socket.on("close", () => {
      this.clients.delete(socket)
    })

    socket.on("error", () => {
      this.clients.delete(socket)
    })
  }

  private broadcast(event: IpcEvent): void {
    const line = JSON.stringify(event) + "\n"
    for (const client of this.clients) {
      try {
        client.write(line)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  private send(socket: Socket, event: IpcEvent): void {
    try {
      socket.write(JSON.stringify(event) + "\n")
    } catch {
      // Client disconnected
    }
  }
}
