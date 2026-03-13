import chalk from "chalk"
import { MemoryStore } from "../memory/store.js"
import { personaExists } from "../persona/loader.js"
import type { Memory } from "../memory/types.js"

interface HistoryOptions {
  sessions?: string
  verbose?: boolean
}

type SessionSource = "cli" | "telegram" | "attach" | "heartbeat"

const TOOL_PATTERNS = [
  /^⏺ (Read|Write|Edit|Bash|Glob|Grep|Search|WebFetch|WebSearch|ListMcpResourcesTool|Agent)\b/gm,
  /^⏺ (\S+)\(/gm,
]

function extractTools(records: Memory[]): string[] {
  const tools = new Set<string>()
  for (const r of records) {
    if (!r.content.startsWith("[assistant]:")) continue
    for (const pattern of TOOL_PATTERNS) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(r.content)) !== null) {
        tools.add(match[1])
      }
    }
  }
  return [...tools]
}

function detectSource(sessionId: string, records: Memory[]): SessionSource {
  if (sessionId.startsWith("heartbeat-")) return "heartbeat"
  for (const r of records) {
    if (r.content.includes("[sent from phone]")) return "telegram"
    if (r.content.includes("[sent from attached terminal]")) return "attach"
  }
  return "cli"
}

function extractTopic(records: Memory[]): string | null {
  const firstUser = records.find(
    r => r.kind === "conversation_turn" && r.content.startsWith("[user]:")
  )
  if (!firstUser) return null

  const text = firstUser.content
    .replace(/^\[user\]:\s*/, "")
    .replace(/^\[sent from (?:phone|attached terminal)\]\s*/, "")

  return text.length > 120 ? text.slice(0, 117) + "..." : text
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 3) + "..."
}

function formatDate(iso: string): string {
  return new Date(iso + "Z").toLocaleString()
}

function sourceLabel(source: SessionSource): string {
  const colors: Record<SessionSource, (s: string) => string> = {
    cli: chalk.blue,
    telegram: chalk.green,
    attach: chalk.cyan,
    heartbeat: chalk.magenta,
  }
  return colors[source](source)
}

export async function showHistory(name: string, options: HistoryOptions): Promise<void> {
  if (!personaExists(name)) {
    console.error(chalk.red(`Persona "${name}" not found.`))
    process.exit(1)
  }

  const limit = options.sessions ? parseInt(options.sessions, 10) : 5
  const verbose = options.verbose ?? false
  const store = new MemoryStore(name)

  try {
    const sessions = store.getSessionTimeline(limit)

    if (sessions.length === 0) {
      console.log(chalk.dim("No activity recorded yet."))
      return
    }

    console.log(chalk.bold(`\n${name} - Recent Activity\n`))

    for (const session of sessions) {
      const records = store.getBySession(session.sessionId)
      const source = detectSource(session.sessionId, records)

      // Header
      const dateRange = session.firstAt === session.lastAt
        ? formatDate(session.firstAt)
        : `${formatDate(session.firstAt)} - ${formatDate(session.lastAt)}`

      const hasTurns = session.kinds.includes("conversation_turn")
      const hasSummary = session.kinds.includes("conversation_summary")
      const isHeartbeat = source === "heartbeat"

      let tag = ""
      if (!isHeartbeat && hasSummary && !hasTurns) tag = "  (summarized)"
      if (!isHeartbeat && hasTurns) {
        const turnCount = records.filter(r => r.kind === "conversation_turn").length
        tag = `  (${turnCount} turns)`
      }

      console.log(chalk.dim("---") + ` ${chalk.bold(dateRange)}  ${sourceLabel(source)}${tag} ` + chalk.dim("---"))

      if (isHeartbeat) {
        renderHeartbeat(records, verbose)
      } else if (hasTurns) {
        renderActiveTurns(records, verbose)
      } else if (hasSummary) {
        renderSummarized(records, verbose)
      } else {
        console.log(chalk.dim("  (no displayable content)"))
      }

      console.log()
    }
  } finally {
    store.close()
  }
}

function renderHeartbeat(records: Memory[], verbose: boolean): void {
  const journal = records.find(r => r.kind === "journal_entry")
  if (!journal) {
    console.log(chalk.dim("  (no journal entry)"))
    return
  }

  const content = journal.content.replace(/^\[Heartbeat reflection\]\s*/, "")
  const maxLen = verbose ? 3000 : 200
  console.log(`  ${truncate(content, maxLen)}`)
}

function renderActiveTurns(records: Memory[], verbose: boolean): void {
  const topic = extractTopic(records)
  if (topic) {
    console.log(`  ${chalk.dim(">")} ${topic}`)
  }

  const tools = extractTools(records)
  if (tools.length > 0) {
    console.log(`  ${chalk.yellow("Tools:")} ${tools.join(", ")}`)
  }

  if (verbose) {
    const turns = records.filter(r => r.kind === "conversation_turn")
    for (const turn of turns) {
      const isAssistant = turn.content.startsWith("[assistant]:")
      const role = isAssistant ? chalk.cyan("assistant") : chalk.green("user")
      const text = turn.content.replace(/^\[(user|assistant)\]:\s*/, "")
      const display = truncate(text, 3000)
      console.log(`  ${role}: ${display}`)
    }
  } else {
    // Show a condensed assistant response
    const lastAssistant = [...records]
      .reverse()
      .find(r => r.kind === "conversation_turn" && r.content.startsWith("[assistant]:"))
    if (lastAssistant) {
      const text = lastAssistant.content.replace(/^\[assistant\]:\s*/, "")
      console.log(`  ${truncate(text, 200)}`)
    }
  }
}

function renderSummarized(records: Memory[], verbose: boolean): void {
  const summary = records.find(r => r.kind === "conversation_summary")
  if (summary) {
    const maxLen = verbose ? 3000 : 200
    console.log(`  ${truncate(summary.content, maxLen)}`)
  }

  const learned = records.filter(r => r.kind === "core_memory" || r.kind === "relationship_note")
  if (learned.length > 0) {
    for (const m of learned) {
      console.log(`  ${chalk.dim(`Learned: "${truncate(m.content, 100)}"`)}`  )
    }
  }
}
