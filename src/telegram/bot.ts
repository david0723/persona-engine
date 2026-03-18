const API_BASE = "https://api.telegram.org/bot"

interface TelegramMessage {
  chatId: number
  text: string
  messageId: number
  from: string
}

export async function setWebhook(token: string, url: string): Promise<void> {
  const res = await fetch(`${API_BASE}${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })

  const data = await res.json() as { ok: boolean; description?: string }
  if (!data.ok) {
    throw new Error(`Failed to set webhook: ${data.description}`)
  }
}

export async function deleteWebhook(token: string): Promise<void> {
  await fetch(`${API_BASE}${token}/deleteWebhook`, { method: "POST" })
}

export async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  // Telegram has a 4096 char limit per message, split if needed
  const chunks = splitMessage(text, 4000)

  for (const chunk of chunks) {
    const res = await fetch(`${API_BASE}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "Markdown",
      }),
    })

    const data = await res.json() as { ok: boolean; description?: string }
    if (!data.ok) {
      // Retry without Markdown if parsing fails
      if (data.description?.includes("parse")) {
        await fetch(`${API_BASE}${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        })
      }
    }
  }
}

export function parseUpdate(body: Record<string, unknown>): TelegramMessage | null {
  const message = body.message as Record<string, unknown> | undefined
  if (!message) return null

  const text = message.text as string | undefined
  if (!text) return null

  const chat = message.chat as Record<string, unknown>
  const from = message.from as Record<string, unknown> | undefined

  return {
    chatId: chat.id as number,
    text,
    messageId: message.message_id as number,
    from: (from?.first_name as string) ?? "Unknown",
  }
}

export interface InlineButton {
  text: string
  callback_data: string
}

export interface CallbackQuery {
  id: string
  chatId: number
  messageId: number
  data: string
  from: string
}

/**
 * Send a message with inline keyboard buttons.
 * Used for read receipts and feedback on scheduled messages.
 */
export async function sendMessageWithButtons(
  token: string,
  chatId: number,
  text: string,
  buttons: InlineButton[][],
): Promise<number | null> {
  const chunks = splitMessage(text, 4000)
  let lastMessageId: number | null = null

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: "Markdown",
    }
    // Only add buttons to the last chunk
    if (isLast && buttons.length > 0) {
      payload.reply_markup = { inline_keyboard: buttons }
    }

    const res = await fetch(`${API_BASE}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string }
    if (!data.ok && data.description?.includes("parse")) {
      // Retry without Markdown
      delete payload.parse_mode
      const retryRes = await fetch(`${API_BASE}${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const retryData = await retryRes.json() as { ok: boolean; result?: { message_id: number } }
      if (retryData.ok) lastMessageId = retryData.result?.message_id ?? null
    } else if (data.ok) {
      lastMessageId = data.result?.message_id ?? null
    }
  }

  return lastMessageId
}

/**
 * Answer a callback query (acknowledges button press in Telegram UI).
 */
export async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`${API_BASE}${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text ?? "Noted!",
    }),
  })
}

/**
 * Parse a callback query from a Telegram update.
 */
export function parseCallbackQuery(body: Record<string, unknown>): CallbackQuery | null {
  const cq = body.callback_query as Record<string, unknown> | undefined
  if (!cq) return null

  const data = cq.data as string | undefined
  if (!data) return null

  const message = cq.message as Record<string, unknown> | undefined
  const chat = message?.chat as Record<string, unknown> | undefined
  const from = cq.from as Record<string, unknown> | undefined

  return {
    id: cq.id as string,
    chatId: (chat?.id as number) ?? 0,
    messageId: (message?.message_id as number) ?? 0,
    data,
    from: (from?.first_name as string) ?? "Unknown",
  }
}

export async function sendChatAction(token: string, chatId: number, action = "typing"): Promise<void> {
  await fetch(`${API_BASE}${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  })
}

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    // Try to split at a newline
    let splitAt = remaining.lastIndexOf("\n", maxLen)
    if (splitAt < maxLen / 2) splitAt = maxLen

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}
