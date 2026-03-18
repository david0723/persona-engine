import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { parseUpdate, parseCallbackQuery, sendMessage, sendChatAction, answerCallbackQuery } from "./bot.js"
import type { ConversationEngine } from "../runtime/engine.js"
import { createMetricsLogger, type MetricsLogger } from "../vault/metrics.js"
import { handleSlashCommand } from "./commands.js"

const BRAIN_DUMP_KEYWORDS = /\bbrain\s*dump\b|\bdump\b/i
const BRAIN_DUMP_MIN_LENGTH = 500

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
  // Initialize metrics logger if vault is enabled
  const vaultPath = engine.persona.vault?.enabled ? engine.persona.vault.path : undefined
  const metrics = createMetricsLogger(vaultPath)

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }))
      return
    }

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
      handleUpdate(engine, token, body, allowedChatIds, metrics).catch(err => {
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
  metrics?: MetricsLogger | null,
): Promise<void> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return
  }

  // Handle callback queries (button presses on inline keyboards)
  const callback = parseCallbackQuery(parsed)
  if (callback) {
    await handleCallbackQuery(token, callback, metrics)
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

  // Handle slash commands first (instant response, no AI needed)
  if (message.text.startsWith("/")) {
    const result = await handleSlashCommand(message.text, engine, metrics)
    if (result.handled) {
      await sendMessage(token, message.chatId, result.text)
      metrics?.log({ source: "telegram", label: message.text.split(" ")[0], outcome: "ok" })
      return
    }
  }

  // Brain dump detection: save long messages or those containing "brain dump"/"dump"
  // to the vault Inbox/ for structured processing
  const isBrainDump = BRAIN_DUMP_KEYWORDS.test(message.text) || message.text.length > BRAIN_DUMP_MIN_LENGTH
  if (isBrainDump && engine.persona.vault?.enabled) {
    const vaultPath = engine.persona.vault.path ?? "/home/persona/vault"
    const inboxDir = join(vaultPath, "Inbox")
    if (existsSync(inboxDir)) {
      const date = new Date().toISOString().slice(0, 10)
      const slug = message.text.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "").toLowerCase()
      const filename = `${date}-telegram-${slug}.md`
      const filepath = join(inboxDir, filename)
      const content = `# Brain Dump (Telegram)\n\n**From:** ${message.from}\n**Date:** ${new Date().toISOString()}\n\n---\n\n${message.text}\n`
      try {
        writeFileSync(filepath, content, "utf-8")
        console.log(`[telegram] Brain dump saved to ${filepath}`)
      } catch (err) {
        console.error(`Failed to save brain dump: ${(err as Error).message}`)
      }
    }
  }

  // Send typing indicator and keep it alive while processing
  const typingInterval = setInterval(() => {
    sendChatAction(token, message.chatId).catch(() => {})
  }, 4000)
  await sendChatAction(token, message.chatId).catch(() => {})

  const startTime = Date.now()
  try {
    // If it's a brain dump, pre-classify and add vault context
    let messageText = message.text
    if (isBrainDump && engine.persona.vault?.enabled) {
      const context = await buildBrainDumpContext(message.text, engine)
      messageText = `[BRAIN DUMP from Telegram - already saved to Inbox/]\n${context}\n\nProcess this brain dump: extract tasks, ideas, and any actionable items. Then send me a summary.\n\n${message.text}`
    }

    const response = await engine.handleMessage(messageText, {
      type: "telegram",
      chatId: message.chatId,
    })

    clearInterval(typingInterval)

    if (response) {
      await sendMessage(token, message.chatId, response)
    }

    metrics?.logTelegram(message.text, "ok", Date.now() - startTime)
  } catch (err) {
    clearInterval(typingInterval)
    const errMsg = (err as Error).message
    console.error(`Error processing Telegram message: ${errMsg}`)
    await sendMessage(token, message.chatId, "Something went wrong while processing your message.")
    metrics?.logTelegram(message.text, "error", Date.now() - startTime, errMsg)
  }
}

/**
 * Pre-classify a brain dump and find related vault content.
 * Returns context string to prepend to the processing prompt.
 */
async function buildBrainDumpContext(text: string, engine: ConversationEngine): Promise<string> {
  const parts: string[] = []

  // Pre-classify the content
  const hasDate = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|deadline|due|by \w+day)\b/i.test(text)
  const hasEmotion = /\b(feel|feeling|stressed|happy|worried|excited|frustrated|grateful|anxious|overwhelmed)\b/i.test(text)
  const hasTasks = /\b(need to|should|must|have to|todo|task|action|do this|remember to)\b/i.test(text)

  const hints: string[] = []
  if (hasDate) hints.push("Contains dates/deadlines - prioritize task extraction with due dates")
  if (hasEmotion) hints.push("Contains emotional/reflective content - extract journal entry")
  if (hasTasks) hints.push("Contains action items - extract as tasks with priorities")
  if (!hasDate && !hasEmotion && !hasTasks) hints.push("General brain dump - categorize freely")

  if (hints.length > 0) {
    parts.push(`Classification hints:\n${hints.map(h => `- ${h}`).join("\n")}`)
  }

  // Find related vault content via semantic search
  try {
    const { searchVault } = await import("../vault/search.js")
    const db = engine.memoryStore.getDb()
    // Use the first 200 chars as search query
    const query = text.slice(0, 200)
    const results = await searchVault(query, db, 3)

    if (results.length > 0 && results[0].similarity > 0.3) {
      const related = results
        .filter(r => r.similarity > 0.3)
        .map(r => `- [${(r.similarity * 100).toFixed(0)}%] ${r.filePath}: ${r.title}`)
        .join("\n")
      parts.push(`Related vault content (consider when filing):\n${related}`)
    }
  } catch {
    // Vault search unavailable, continue without context
  }

  return parts.length > 0 ? parts.join("\n\n") : ""
}

async function handleCallbackQuery(
  token: string,
  callback: { id: string; chatId: number; data: string; from: string },
  metrics?: MetricsLogger | null,
): Promise<void> {
  const { id, data, from } = callback

  switch (data) {
    case "ack":
      await answerCallbackQuery(token, id, "Got it!")
      metrics?.log({ source: "telegram", label: `${from} acknowledged scheduled message`, outcome: "ok" })
      break
    case "not_useful":
      await answerCallbackQuery(token, id, "Feedback noted")
      metrics?.log({ source: "telegram", label: `${from} marked scheduled message as not useful`, outcome: "ok" })
      break
    default:
      await answerCallbackQuery(token, id)
  }
}
