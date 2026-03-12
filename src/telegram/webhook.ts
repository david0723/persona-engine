import { createServer, type Server } from "node:http"
import { parseUpdate, sendMessage } from "./bot.js"
import type { ConversationEngine } from "../runtime/engine.js"

export function startWebhookServer(
  engine: ConversationEngine,
  token: string,
  port: number,
  allowedChatIds?: number[],
): Server {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/webhook")) {
      res.writeHead(404)
      res.end()
      return
    }

    let body = ""
    req.on("data", (chunk) => { body += chunk })

    req.on("end", () => {
      // Respond 200 immediately (Telegram expects fast response)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))

      // Process async
      handleUpdate(engine, token, body, allowedChatIds).catch(err => {
        console.error(`Telegram handler error: ${(err as Error).message}`)
      })
    })
  })

  server.listen(port, () => {
    console.log(`Webhook server listening on port ${port}`)
  })

  return server
}

async function handleUpdate(
  engine: ConversationEngine,
  token: string,
  rawBody: string,
  allowedChatIds?: number[],
): Promise<void> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return
  }

  const message = parseUpdate(parsed)
  if (!message) return

  // Security: only allow configured chat IDs
  if (allowedChatIds && allowedChatIds.length > 0 && !allowedChatIds.includes(message.chatId)) {
    await sendMessage(token, message.chatId, "Sorry, I'm not configured to chat with you.")
    return
  }

  console.log(`[telegram] ${message.from}: ${message.text}`)

  try {
    const response = await engine.handleMessage(message.text, {
      type: "telegram",
      chatId: message.chatId,
    })

    if (response) {
      await sendMessage(token, message.chatId, response)
    }
  } catch (err) {
    console.error(`Error processing Telegram message: ${(err as Error).message}`)
    await sendMessage(token, message.chatId, "Something went wrong while processing your message.")
  }
}
