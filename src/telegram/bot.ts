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

function splitMessage(text: string, maxLen: number): string[] {
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
