import type { Server } from "node:http"
import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { ConversationEngine } from "./engine.js"
import { IpcServer } from "./ipc-server.js"
import { startWebhookServer } from "../telegram/webhook.js"
import { setWebhook, deleteWebhook } from "../telegram/bot.js"
import { runHeartbeat } from "./heartbeat-runner.js"

export async function startContainerServer(name: string, port: number): Promise<void> {
  const persona = loadPersona(name)
  const engine = new ConversationEngine(persona)
  const ipc = new IpcServer(engine, name)

  ipc.start()
  console.log(chalk.green(`IPC socket ready for ${name}`))

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
