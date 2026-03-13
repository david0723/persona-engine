import { createConnection, type Socket } from "node:net"
import { createInterface } from "node:readline"
import chalk from "chalk"
import { socketPath } from "./ipc-server.js"
import {
  writeChunk,
  writeLine,
  writePersonaHeader,
  writeSystem,
  StatusLine,
} from "../utils/stream.js"
import type { IpcEvent } from "./ipc-server.js"

export interface ConnectOptions {
  /** Connect via TCP port instead of Unix socket. */
  tcpPort?: number
  /** Retry interval in ms on ECONNREFUSED (0 = no retry). */
  retryMs?: number
  /** Total timeout for initial connection in ms. */
  timeoutMs?: number
  /** Show all engine logs including stderr. */
  verbose?: boolean
}

const MAX_EARLY_CLOSE_RETRIES = 3
const EARLY_CLOSE_WINDOW_MS = 2000
const debug = process.env.DEBUG ? (...args: unknown[]) => console.error(chalk.dim("[ipc-client]"), ...args) : () => {}

export function connectToPersona(personaName: string, options?: ConnectOptions): void {
  const status = new StatusLine()
  const verbose = options?.verbose ?? false
  const retryMs = options?.retryMs ?? 0
  const timeoutMs = options?.timeoutMs ?? 0
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0

  let earlyCloseRetries = 0
  let currentSocket: Socket | null = null
  let inputStarted = false
  let rl: ReturnType<typeof createInterface> | null = null
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null
  let waitingMessageShown = false

  // Streaming context: tracks whether we've received chunk events for the current response
  const streamCtx = { streamed: false, headerPrinted: false }

  if (deadline > 0) {
    deadlineTimer = setTimeout(() => {
      console.error(chalk.red("Engine failed to start within timeout."))
      process.exit(1)
    }, timeoutMs)
  }

  function connect(): void {
    let hasReceivedData = false
    let connectTime = 0

    const socket = options?.tcpPort
      ? createConnection({ port: options.tcpPort, host: "127.0.0.1" })
      : createConnection(socketPath(personaName))

    socket.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code

      if ((code === "ECONNREFUSED" || code === "ECONNRESET") && retryMs > 0) {
        if (deadline > 0 && Date.now() >= deadline) {
          console.error(chalk.red("Engine failed to start within timeout."))
          process.exit(1)
        }
        if (!waitingMessageShown) {
          writeSystem("Waiting for engine to start...")
          waitingMessageShown = true
        }
        debug(`${code}, retrying in ${retryMs}ms`)
        setTimeout(connect, retryMs)
        return
      }

      if (code === "ENOENT") {
        console.error(
          chalk.red(`No running instance of "${personaName}" found.`),
        )
        console.error(
          chalk.dim(`Start it first: persona start ${personaName}`),
        )
      } else if (code === "ECONNREFUSED") {
        console.error(
          chalk.red(`Connection refused. "${personaName}" may not be running.`),
        )
      } else {
        console.error(chalk.red(`Connection error: ${err.message}`))
      }
      process.exit(1)
    })

    socket.on("connect", () => {
      connectTime = Date.now()
      currentSocket = socket
      debug("connected")

      if (deadlineTimer) {
        clearTimeout(deadlineTimer)
        deadlineTimer = null
      }

      writeSystem(`Attached to ${personaName}. Press Ctrl+C to detach.\n`)

      if (!inputStarted) {
        inputStarted = true
        startInput()
      } else {
        // Re-show prompt after reconnect
        rl?.prompt()
      }
    })

    let buffer = ""
    socket.on("data", (data) => {
      hasReceivedData = true
      buffer += data.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as IpcEvent
          handleEvent(event, personaName, status, streamCtx, verbose)
        } catch {
          // Ignore malformed JSON
        }
      }
    })

    socket.on("close", (hadError) => {
      const elapsed = connectTime > 0 ? Date.now() - connectTime : 0
      debug(`close: hadError=${hadError}, elapsed=${elapsed}ms, hasData=${hasReceivedData}`)

      // Early close with no data: likely a stale RST from vpnkit
      if (connectTime > 0 && elapsed < EARLY_CLOSE_WINDOW_MS && !hasReceivedData) {
        if (earlyCloseRetries < MAX_EARLY_CLOSE_RETRIES) {
          earlyCloseRetries++
          debug(`early close without data, reconnecting (attempt ${earlyCloseRetries}/${MAX_EARLY_CLOSE_RETRIES})`)
          writeSystem(`Connection dropped, reconnecting (${earlyCloseRetries}/${MAX_EARLY_CLOSE_RETRIES})...`)
          currentSocket = null
          setTimeout(connect, retryMs || 500)
          return
        }
      }

      status.clear()
      writeSystem("\nDisconnected.")
      process.exit(0)
    })
  }

  // Readline is created once and reused across reconnects.
  // It writes to whatever socket is in `currentSocket`.
  function startInput(): void {
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY ?? false,
      prompt: chalk.bold.green("you: "),
    })

    rl.prompt()

    rl.on("line", (line) => {
      if (line.trim() && currentSocket) {
        const msg = JSON.stringify({ type: "message", text: line }) + "\n"
        currentSocket.write(msg)
      }
      rl?.prompt()
    })

    rl.on("close", () => {
      writeSystem("\nDetaching...")
      currentSocket?.end()
      process.exit(0)
    })

    process.on("SIGINT", () => {
      writeSystem("\nDetaching...")
      currentSocket?.end()
      process.exit(0)
    })
  }

  connect()
}

interface StreamContext {
  streamed: boolean
  headerPrinted: boolean
}

function handleEvent(
  event: IpcEvent,
  personaName: string,
  status: StatusLine,
  ctx: StreamContext,
  verbose: boolean,
): void {
  switch (event.type) {
    case "history": {
      if (event.turns && event.turns.length > 0) {
        writeSystem("--- Recent history ---")
        for (const turn of event.turns) {
          if (turn.role === "user") {
            const sourceTag = turn.source !== "cli" ? chalk.dim(` [${turn.source}]`) : ""
            writeLine(chalk.green(`you${sourceTag}: `) + turn.text)
          } else {
            writeLine(chalk.cyan(`${personaName}: `) + turn.text)
          }
        }
        writeSystem("--- End of history ---\n")
      }
      break
    }
    case "thinking":
      ctx.streamed = false
      ctx.headerPrinted = false
      status.show("Thinking")
      break
    case "chunk": {
      if (!ctx.headerPrinted) {
        status.clear()
        writeLine()
        writePersonaHeader(personaName)
        ctx.headerPrinted = true
      }
      writeChunk(event.text ?? "")
      ctx.streamed = true
      break
    }
    case "activity":
      if (!ctx.streamed) {
        status.show(`Using ${event.tool}`)
      }
      break
    case "stderr":
      if (verbose) {
        status.show(`[log] ${event.text}`)
      }
      break
    case "responding":
      status.clear()
      break
    case "message": {
      if (event.source !== "attach") {
        status.clear()
        const sourceLabel = event.source ?? "unknown"
        writeLine(chalk.dim(`[${sourceLabel}] ${event.text}`))
      }
      break
    }
    case "response": {
      status.clear()
      if (ctx.streamed) {
        writeLine()
        writeLine()
      } else {
        writeLine()
        writePersonaHeader(personaName)
        writeLine(event.text ?? "")
        writeLine()
      }
      ctx.streamed = false
      ctx.headerPrinted = false
      break
    }
  }
}
