import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { parseUpdate, sendMessage, sendChatAction } from "./bot.js"
import type { ConversationEngine } from "../runtime/engine.js"

function listenOn(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, () => {
      server.removeListener("error", reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

export async function startWebhookServer(
  engine: ConversationEngine,
  token: string,
  preferredPort: number,
  allowedChatIds?: number[],
): Promise<{ server: Server; port: number }> {
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

  let port: number
  try {
    port = await listenOn(server, preferredPort)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      // Preferred port taken, let the OS pick a free one
      port = await listenOn(server, 0)
    } else {
      throw err
    }
  }

  console.log(`Webhook server listening on port ${port}`)
  return { server, port }
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

  // Send typing indicator and keep it alive while processing
  const typingInterval = setInterval(() => {
    sendChatAction(token, message.chatId).catch(() => {})
  }, 4000)
  await sendChatAction(token, message.chatId).catch(() => {})

  try {
    const response = await engine.handleMessage(message.text, {
      type: "telegram",
      chatId: message.chatId,
    })

    clearInterval(typingInterval)

    if (response) {
      await sendMessage(token, message.chatId, response)
    }
  } catch (err) {
    clearInterval(typingInterval)
    console.error(`Error processing Telegram message: ${(err as Error).message}`)
    await sendMessage(token, message.chatId, "Something went wrong while processing your message.")
  }
}
