import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { ConversationEngine } from "../runtime/engine.js"
import { runCliAdapter } from "../runtime/conversation.js"
import { setWebhook, deleteWebhook } from "../telegram/bot.js"
import { startWebhookServer } from "../telegram/webhook.js"
import { startTunnel, stopTunnel } from "../telegram/tunnel.js"

interface ServeOptions {
  port?: string
  noCli?: boolean
}

export async function servePersona(name: string, options: ServeOptions): Promise<void> {
  const port = parseInt(options.port ?? "3100", 10)

  let persona
  try {
    persona = loadPersona(name)
  } catch (err) {
    console.error(chalk.red((err as Error).message))
    process.exit(1)
  }

  const token = persona.telegram?.bot_token
  if (!token) {
    console.error(chalk.red(`No Telegram bot token configured for "${name}".`))
    console.error(chalk.dim(`Add it to persona.yaml:\n\n  telegram:\n    enabled: true\n    bot_token: "your-bot-token"\n`))
    process.exit(1)
  }

  const engine = new ConversationEngine(persona)

  // Start webhook server
  const allowedChatIds = persona.telegram?.allowed_chat_ids
  const server = startWebhookServer(engine, token, port, allowedChatIds)

  // Resolve public URL: use WEBHOOK_URL env var or start a tunnel
  let tunnelUrl: string
  const envWebhookUrl = process.env.WEBHOOK_URL
  if (envWebhookUrl) {
    tunnelUrl = envWebhookUrl
    console.log(chalk.green(`Using configured webhook URL: ${tunnelUrl}`))
  } else {
    console.log(chalk.dim("Starting tunnel..."))
    try {
      tunnelUrl = await startTunnel(port)
    } catch (err) {
      console.error(chalk.red(`Failed to start tunnel: ${(err as Error).message}`))
      console.error(chalk.dim("Install cloudflared: brew install cloudflared"))
      server.close()
      process.exit(1)
    }
    console.log(chalk.green(`Tunnel active: ${tunnelUrl}`))
  }

  const webhookUrl = `${tunnelUrl}/webhook/${name}`

  // Register webhook with Telegram
  try {
    await setWebhook(token, webhookUrl)
    console.log(chalk.green(`Telegram webhook registered: ${webhookUrl}`))
  } catch (err) {
    console.error(chalk.red(`Failed to set webhook: ${(err as Error).message}`))
    stopTunnel()
    server.close()
    process.exit(1)
  }

  console.log(chalk.bold(`\n${persona.name} is live on Telegram and CLI.\n`))

  // Cleanup on exit
  const cleanup = async () => {
    console.log(chalk.dim("\nShutting down..."))
    try { await deleteWebhook(token) } catch { /* ignore */ }
    stopTunnel()
    server.close()
    await engine.shutdown()
    console.log(chalk.dim("Done."))
    process.exit(0)
  }

  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)

  // Start CLI adapter unless --no-cli
  if (!options.noCli) {
    await runCliAdapter(engine)
  } else {
    // Keep the process alive
    console.log(chalk.dim("Running in Telegram-only mode. Press Ctrl+C to stop."))
    await new Promise(() => {}) // block forever
  }
}
