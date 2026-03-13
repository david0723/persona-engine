import type { Server } from "node:http"
import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { ConversationEngine } from "./engine.js"
import { writeInstructionsFile } from "./opencode-config.js"
import { IpcServer, IPC_TCP_PORT } from "./ipc-server.js"
import { startWebhookServer } from "../telegram/webhook.js"
import { setWebhook, deleteWebhook } from "../telegram/bot.js"
import { runHeartbeat } from "./heartbeat-runner.js"
import { paths } from "../utils/config.js"

const OPENCODE_BIN_CONTAINER = "/home/persona/.opencode/bin/opencode"
export const OPENCODE_WEB_PORT = 3102

process.on("uncaughtException", (err) => {
  console.error(`Uncaught exception: ${err.message}`)
  console.error(err.stack)
})
process.on("unhandledRejection", (reason) => {
  console.error(`Unhandled rejection: ${reason}`)
})

function startOpenCodeServer(name: string, webPort: number, model?: string): ChildProcess {
  const dir = paths.personaDir(name)
  const args = ["serve", "--port", String(webPort), "--hostname", "0.0.0.0", "--dir", dir]
  if (model) args.push("--model", model)

  const child = spawn(OPENCODE_BIN_CONTAINER, args, {
    stdio: ["ignore", "pipe", "pipe"],
  })

  child.stdout.on("data", (data: Buffer) => {
    process.stdout.write(chalk.dim(`[opencode] ${data.toString()}`))
  })
  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString().trim()
    if (text) console.error(chalk.dim(`[opencode] ${text}`))
  })
  child.on("exit", (code) => {
    console.error(chalk.yellow(`opencode serve exited with code ${code}`))
  })

  return child
}

export async function startContainerServer(name: string, port: number): Promise<void> {
  const persona = loadPersona(name)
  const engine = new ConversationEngine(persona)
  const ipc = new IpcServer(engine, name)

  // Write INSTRUCTIONS.md so opencode serve picks up the persona's system prompt
  writeInstructionsFile(persona, engine.memoryStore)

  ipc.start({ tcpPort: IPC_TCP_PORT })
  console.log(chalk.green(`IPC ready for ${name} (socket + tcp:${IPC_TCP_PORT})`))

  // Start opencode serve when web mode is enabled
  const webMode = process.env.PERSONA_WEB === "true"
  let openCodeProcess: ChildProcess | undefined

  if (webMode) {
    openCodeProcess = startOpenCodeServer(name, OPENCODE_WEB_PORT, persona.model)
    const attachUrl = `http://localhost:${OPENCODE_WEB_PORT}`
    engine.attachUrl = attachUrl
    console.log(chalk.green(`opencode serve started on port ${OPENCODE_WEB_PORT}`))
  }

  // Telegram webhook (optional)
  const token = persona.telegram?.bot_token
  const webhookUrl = process.env.WEBHOOK_URL
  let webhookServer: Server | undefined

  if (token && webhookUrl) {
    const allowedChatIds = persona.telegram?.allowed_chat_ids
    const result = await startWebhookServer(engine, token, port, allowedChatIds)
    webhookServer = result.server
    await setWebhook(token, `${webhookUrl}/webhook/${name}`)
    console.log(chalk.green(`Telegram webhook registered: ${webhookUrl}/webhook/${name}`))
  } else if (token && !webhookUrl) {
    console.log(chalk.dim("Telegram bot token found but no WEBHOOK_URL set. Skipping Telegram."))
  }

  // Heartbeat (optional)
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined

  if (persona.heartbeat?.enabled) {
    const intervalMs = (persona.heartbeat.interval_minutes ?? 60) * 60 * 1000
    console.log(chalk.dim(`Heartbeat enabled: every ${persona.heartbeat.interval_minutes ?? 60}min`))
    heartbeatInterval = setInterval(() => {
      runHeartbeat(persona).catch((err) => {
        console.error(`Heartbeat error: ${(err as Error).message}`)
      })
    }, intervalMs)
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log(chalk.dim("\nShutting down container server..."))

    if (heartbeatInterval) clearInterval(heartbeatInterval)

    if (openCodeProcess && !openCodeProcess.killed) {
      openCodeProcess.kill("SIGTERM")
    }

    if (token && webhookUrl) {
      await deleteWebhook(token).catch(() => {})
    }

    if (webhookServer) {
      webhookServer.close()
    }

    await engine.shutdown()
    ipc.stop()

    console.log(chalk.dim("Shutdown complete."))
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // Keep alive
  await new Promise(() => {})
}
