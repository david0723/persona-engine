import { createConnection } from "node:net"
import { createInterface } from "node:readline"
import chalk from "chalk"
import { socketPath } from "./ipc-server.js"
import {
  writeLine,
  writePersonaHeader,
  writeSystem,
  StatusLine,
} from "../utils/stream.js"
import type { IpcEvent } from "./ipc-server.js"

export interface ConnectOptions {
  /** Connect via TCP port instead of Unix socket. */
  tcpPort?: number
}

export function connectToPersona(personaName: string, options?: ConnectOptions): void {
  const status = new StatusLine()

  const socket = options?.tcpPort
    ? createConnection({ port: options.tcpPort, host: "127.0.0.1" })
    : createConnection(socketPath(personaName))

  socket.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        chalk.red(`No running instance of "${personaName}" found.`),
      )
      console.error(
        chalk.dim(`Start it first: persona start ${personaName}`),
      )
    } else if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      console.error(
        chalk.red(`Connection refused. "${personaName}" may not be running.`),
      )
    } else {
      console.error(chalk.red(`Connection error: ${err.message}`))
    }
    process.exit(1)
  })

  socket.on("connect", () => {
    writeSystem(`Attached to ${personaName}. Press Ctrl+C to detach.\n`)
    startInput()
  })

  let buffer = ""
  socket.on("data", (data) => {
    buffer += data.toString()
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as IpcEvent
        handleEvent(event, personaName, status)
      } catch {
        // Ignore malformed JSON
      }
    }
  })

  socket.on("close", () => {
    status.clear()
    writeSystem("\nDisconnected.")
    process.exit(0)
  })

  function startInput(): void {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY ?? false,
      prompt: chalk.bold.green("you: "),
    })

    rl.prompt()

    rl.on("line", (line) => {
      if (line.trim()) {
        const msg = JSON.stringify({ type: "message", text: line }) + "\n"
        socket.write(msg)
      }
      rl.prompt()
    })

    rl.on("close", () => {
      writeSystem("\nDetaching...")
      socket.end()
      process.exit(0)
    })

    process.on("SIGINT", () => {
      writeSystem("\nDetaching...")
      socket.end()
      process.exit(0)
    })
  }
}

function handleEvent(
  event: IpcEvent,
  personaName: string,
  status: StatusLine,
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
      status.show("Thinking")
      break
    case "activity":
      status.show(`Using ${event.tool}`)
      break
    case "responding":
      status.clear()
      break
    case "message": {
      // Show messages from other sources
      if (event.source !== "attach") {
        status.clear()
        const sourceLabel = event.source ?? "unknown"
        writeLine(chalk.dim(`[${sourceLabel}] ${event.text}`))
      }
      break
    }
    case "response": {
      status.clear()
      writeLine()
      writePersonaHeader(personaName)
      writeLine(event.text ?? "")
      writeLine()
      break
    }
  }
}
