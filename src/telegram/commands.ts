/**
 * Telegram slash command handlers.
 * These bypass the AI for instant response on common operations.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { ConversationEngine } from "../runtime/engine.js"
import type { MetricsLogger } from "../vault/metrics.js"

interface CommandResult {
  text: string
  handled: boolean
}

/**
 * Try to handle a message as a slash command.
 * Returns { handled: true, text } if it was a command, { handled: false } otherwise.
 */
export async function handleSlashCommand(
  text: string,
  engine: ConversationEngine,
  metrics?: MetricsLogger | null,
): Promise<CommandResult> {
  if (!text.startsWith("/")) return { text: "", handled: false }

  const [cmd, ...args] = text.split(" ")
  const argText = args.join(" ").trim()

  switch (cmd) {
    case "/brain":
      return handleBrain(argText, engine, metrics)
    case "/journal":
      return handleJournal(argText, engine, metrics)
    case "/todo":
      return handleTodo(argText, engine, metrics)
    case "/search":
      return handleSearch(argText, engine)
    case "/schedules":
      return handleSchedules(engine)
    case "/dashboard":
      return handleDashboard(engine)
    case "/help":
      return {
        handled: true,
        text: `Available commands:
/brain <text> - Save a brain dump to Inbox/
/journal <text> - Add a journal entry
/todo <task> - Quick-add a task to Active.md
/search <query> - Search the vault
/schedules - Show active schedules
/dashboard - Show current Dashboard.md
/help - Show this message`,
      }
    default:
      // Unknown command, let the AI handle it
      return { text: "", handled: false }
  }
}

function getVaultPath(engine: ConversationEngine): string | null {
  if (!engine.persona.vault?.enabled) return null
  return engine.persona.vault.path ?? "/home/persona/vault"
}

function handleBrain(text: string, engine: ConversationEngine, metrics?: MetricsLogger | null): CommandResult {
  if (!text) return { handled: true, text: "Usage: /brain <your brain dump text>" }

  const vaultPath = getVaultPath(engine)
  if (!vaultPath) return { handled: true, text: "Vault not configured." }

  const inboxDir = join(vaultPath, "Inbox")
  if (!existsSync(inboxDir)) return { handled: true, text: "Inbox/ directory not found in vault." }

  const date = new Date().toISOString().slice(0, 10)
  const slug = text.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "").toLowerCase()
  const filename = `${date}-brain-${slug}.md`
  const filepath = join(inboxDir, filename)

  const content = `# Brain Dump\n\n**Date:** ${new Date().toISOString()}\n**Source:** Telegram /brain command\n\n---\n\n${text}\n`

  try {
    writeFileSync(filepath, content, "utf-8")
    metrics?.log({ source: "telegram", label: "/brain command", outcome: "ok" })
    return { handled: true, text: `Saved to Inbox/${filename}. The watcher will process it shortly.` }
  } catch (err) {
    return { handled: true, text: `Failed to save: ${(err as Error).message}` }
  }
}

function handleJournal(text: string, engine: ConversationEngine, metrics?: MetricsLogger | null): CommandResult {
  if (!text) return { handled: true, text: "Usage: /journal <your entry>" }

  const vaultPath = getVaultPath(engine)
  if (!vaultPath) return { handled: true, text: "Vault not configured." }

  const journalDir = join(vaultPath, "Journal")
  if (!existsSync(journalDir)) return { handled: true, text: "Journal/ directory not found in vault." }

  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = now.toISOString().slice(11, 16)
  const filepath = join(journalDir, `${date}.md`)

  try {
    if (existsSync(filepath)) {
      appendFileSync(filepath, `\n## ${time}\n\n${text}\n`, "utf-8")
    } else {
      writeFileSync(filepath, `# Journal - ${date}\n\n## ${time}\n\n${text}\n`, "utf-8")
    }
    metrics?.log({ source: "telegram", label: "/journal command", outcome: "ok" })
    return { handled: true, text: `Added to Journal/${date}.md` }
  } catch (err) {
    return { handled: true, text: `Failed to write journal: ${(err as Error).message}` }
  }
}

function handleTodo(text: string, engine: ConversationEngine, metrics?: MetricsLogger | null): CommandResult {
  if (!text) return { handled: true, text: "Usage: /todo <task description>" }

  const vaultPath = getVaultPath(engine)
  if (!vaultPath) return { handled: true, text: "Vault not configured." }

  const activePath = join(vaultPath, "Todos", "Active.md")
  if (!existsSync(activePath)) return { handled: true, text: "Todos/Active.md not found in vault." }

  const date = new Date().toISOString().slice(0, 10)
  const entry = `\n- [ ] ${text} (from Telegram, ${date})\n`

  try {
    appendFileSync(activePath, entry, "utf-8")
    metrics?.log({ source: "telegram", label: "/todo command", outcome: "ok" })
    return { handled: true, text: `Added to Todos/Active.md: "${text}"` }
  } catch (err) {
    return { handled: true, text: `Failed to add todo: ${(err as Error).message}` }
  }
}

async function handleSearch(query: string, engine: ConversationEngine): Promise<CommandResult> {
  if (!query) return { handled: true, text: "Usage: /search <query>" }

  const vaultPath = getVaultPath(engine)
  if (!vaultPath) return { handled: true, text: "Vault not configured." }

  try {
    const { searchVault } = await import("../vault/search.js")
    const db = engine.memoryStore.getDb()
    const results = await searchVault(query, db, 5)

    if (results.length === 0) return { handled: true, text: "No results found." }

    const lines = results.map(r => {
      const score = (r.similarity * 100).toFixed(0)
      const preview = r.snippet.replace(/\n/g, " ").slice(0, 100)
      return `[${score}%] *${r.title}*\n${r.filePath}\n${preview}...`
    })

    return { handled: true, text: lines.join("\n\n") }
  } catch (err) {
    return { handled: true, text: `Search error: ${(err as Error).message}` }
  }
}

function handleSchedules(engine: ConversationEngine): CommandResult {
  const vaultPath = getVaultPath(engine)
  if (!vaultPath) return { handled: true, text: "Vault not configured." }

  const schedulesPath = join(vaultPath, "Schedules", "schedules.yaml")
  if (!existsSync(schedulesPath)) return { handled: true, text: "No schedules.yaml found." }

  try {
    const content = readFileSync(schedulesPath, "utf-8")
    // Extract schedule summaries
    const lines: string[] = []
    const scheduleRegex = /- id: (.+)\n\s+cron: "(.+)"\n\s+label: (.+)/g
    let match
    while ((match = scheduleRegex.exec(content)) !== null) {
      lines.push(`*${match[3].trim()}*\n  Cron: \`${match[2]}\``)
    }

    if (lines.length === 0) return { handled: true, text: "No schedules found in schedules.yaml." }
    return { handled: true, text: `Active schedules:\n\n${lines.join("\n\n")}` }
  } catch (err) {
    return { handled: true, text: `Error reading schedules: ${(err as Error).message}` }
  }
}

function handleDashboard(engine: ConversationEngine): CommandResult {
  const vaultPath = getVaultPath(engine)
  if (!vaultPath) return { handled: true, text: "Vault not configured." }

  const dashboardPath = join(vaultPath, "Dashboard.md")
  if (!existsSync(dashboardPath)) return { handled: true, text: "Dashboard.md not found. It will be generated by the daily-dashboard schedule." }

  try {
    const content = readFileSync(dashboardPath, "utf-8")
    return { handled: true, text: content.slice(0, 4000) }
  } catch (err) {
    return { handled: true, text: `Error reading dashboard: ${(err as Error).message}` }
  }
}
