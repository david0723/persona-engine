import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createConnection, type Socket } from "node:net"
import { IpcServer, type IpcEvent } from "./ipc-server.js"
import { createFakeEngine } from "../test-helpers/ipc-helpers.js"
import { getAvailablePort } from "../test-helpers/port-finder.js"
import { useTempPersonaHome } from "../test-helpers/temp-dir.js"
import type { ConversationEngine } from "./engine.js"

let tempHome: ReturnType<typeof useTempPersonaHome>
let server: IpcServer
let port: number
let clients: Socket[]

function connectClient(tcpPort: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createConnection({ port: tcpPort, host: "127.0.0.1" }, () => {
      resolve(client)
    })
    client.on("error", reject)
  })
}

function readEvents(client: Socket, count: number, timeoutMs = 3000): Promise<IpcEvent[]> {
  return new Promise((resolve, reject) => {
    const events: IpcEvent[] = []
    let buffer = ""
    const timeout = setTimeout(() => {
      resolve(events) // resolve with whatever we have
    }, timeoutMs)

    client.on("data", (data) => {
      buffer += data.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          events.push(JSON.parse(line))
        } catch { /* ignore */ }
      }

      if (events.length >= count) {
        clearTimeout(timeout)
        resolve(events)
      }
    })

    client.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function sendMessage(client: Socket, msg: { type: string; text: string }): void {
  client.write(JSON.stringify(msg) + "\n")
}

beforeEach(async () => {
  tempHome = useTempPersonaHome()
  port = await getAvailablePort()
  clients = []
})

afterEach(() => {
  for (const c of clients) {
    c.destroy()
  }
  server?.stop()
  tempHome.cleanup()
})

describe("IPC server/client over TCP", () => {
  describe("connection and history", () => {
    it("client receives history event on connect", async () => {
      const turns = [
        { role: "user", text: "Hello", source: "cli", created_at: "2024-01-01T00:00:00Z" },
        { role: "assistant", text: "Hi there!", source: "cli", created_at: "2024-01-01T00:00:01Z" },
      ]
      const engine = createFakeEngine(turns)
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client = await connectClient(port)
      clients.push(client)

      const events = await readEvents(client, 1)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("history")
      expect(events[0].turns).toHaveLength(2)
      expect(events[0].turns![0].text).toBe("Hello")
      expect(events[0].turns![1].text).toBe("Hi there!")
    })

    it("client receives empty history when no turns exist", async () => {
      const engine = createFakeEngine([])
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client = await connectClient(port)
      clients.push(client)

      const events = await readEvents(client, 1)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("history")
      expect(events[0].turns).toHaveLength(0)
    })
  })

  describe("message flow", () => {
    it("client sends JSON message, server calls engine.handleMessage", async () => {
      const engine = createFakeEngine()
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client = await connectClient(port)
      clients.push(client)

      // Wait for history event first
      await readEvents(client, 1)

      sendMessage(client, { type: "message", text: "Hello engine" })

      // Wait for the response event broadcast
      const events = await readEvents(client, 1)
      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(engine.lastMessage).not.toBeNull()
      expect(engine.lastMessage!.text).toBe("Hello engine")
      expect(engine.lastMessage!.source.type).toBe("attach")
    })

    it("server broadcasts response event back to client", async () => {
      const engine = createFakeEngine()
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client = await connectClient(port)
      clients.push(client)

      await readEvents(client, 1) // history

      sendMessage(client, { type: "message", text: "Test message" })

      const events = await readEvents(client, 1, 5000)
      const responseEvent = events.find((e) => e.type === "response")
      expect(responseEvent).toBeDefined()
      expect(responseEvent!.text).toContain("Test message")
    })

    it("malformed JSON is ignored, connection stays alive", async () => {
      const engine = createFakeEngine()
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client = await connectClient(port)
      clients.push(client)

      await readEvents(client, 1) // history

      // Send malformed JSON
      client.write("not valid json\n")

      // Connection should still work
      sendMessage(client, { type: "message", text: "After malformed" })

      const events = await readEvents(client, 1, 5000)
      expect(engine.lastMessage).not.toBeNull()
      expect(engine.lastMessage!.text).toBe("After malformed")
    })
  })

  describe("multi-client", () => {
    it("two clients both receive broadcast events", async () => {
      const engine = createFakeEngine()
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client1 = await connectClient(port)
      const client2 = await connectClient(port)
      clients.push(client1, client2)

      // Both get history
      await readEvents(client1, 1)
      await readEvents(client2, 1)

      // Send a message from client1
      sendMessage(client1, { type: "message", text: "Broadcast test" })

      // Both clients should receive the response broadcast
      const [events1, events2] = await Promise.all([
        readEvents(client1, 1, 5000),
        readEvents(client2, 1, 5000),
      ])

      expect(events1.some((e) => e.type === "response")).toBe(true)
      expect(events2.some((e) => e.type === "response")).toBe(true)
    })

    it("client disconnect does not affect other clients", async () => {
      const engine = createFakeEngine()
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client1 = await connectClient(port)
      const client2 = await connectClient(port)
      clients.push(client1, client2)

      await readEvents(client1, 1)
      await readEvents(client2, 1)

      // Disconnect client1
      client1.destroy()

      // Wait a tick for disconnect to propagate
      await new Promise((r) => setTimeout(r, 50))

      // client2 should still work
      sendMessage(client2, { type: "message", text: "Still alive" })

      const events = await readEvents(client2, 1, 5000)
      expect(events.some((e) => e.type === "response")).toBe(true)
    })
  })

  describe("lifecycle", () => {
    it("server.stop() closes all connections", async () => {
      const engine = createFakeEngine()
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client = await connectClient(port)
      clients.push(client)

      await readEvents(client, 1) // history

      const closePromise = new Promise<void>((resolve) => {
        client.on("close", () => resolve())
      })

      server.stop()
      await closePromise // client should receive close event
    })

    it("client disconnect removes from client set", async () => {
      const engine = createFakeEngine()
      server = new IpcServer(engine as unknown as ConversationEngine, "test-persona")
      server.start({ tcpPort: port })

      const client = await connectClient(port)
      clients.push(client)

      await readEvents(client, 1) // history

      client.destroy()

      // Wait for disconnect
      await new Promise((r) => setTimeout(r, 50))

      // Server should not throw when broadcasting to no clients
      engine.emit("response", { source: { type: "cli" }, role: "assistant", text: "no crash" })
    })
  })
})
