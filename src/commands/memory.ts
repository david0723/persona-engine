import chalk from "chalk"
import { MemoryStore } from "../memory/store.js"
import { personaExists } from "../persona/loader.js"
import type { MemoryKind } from "../memory/types.js"

interface MemoryOptions {
  kind?: string
  recent?: string
}

export async function inspectMemory(name: string, options: MemoryOptions): Promise<void> {
  if (!personaExists(name)) {
    console.error(chalk.red(`Persona "${name}" not found.`))
    process.exit(1)
  }

  const store = new MemoryStore(name)

  try {
    if (options.kind) {
      const kind = options.kind as MemoryKind
      const limit = options.recent ? parseInt(options.recent, 10) : 10
      const memories = store.getByKind(kind, limit)

      if (memories.length === 0) {
        console.log(chalk.dim(`No ${kind} memories found.`))
        return
      }

      console.log(chalk.bold(`\n${kind} memories (${memories.length}):\n`))
      for (const m of memories) {
        const date = new Date(m.created_at).toLocaleString()
        console.log(chalk.dim(`[${date}] importance: ${m.importance}`))
        console.log(`  ${m.content}\n`)
      }
    } else {
      // Show stats
      const stats = store.stats()
      console.log(chalk.bold(`\nMemory stats for ${name}:\n`))

      if (Object.keys(stats).length === 0) {
        console.log(chalk.dim("  No memories yet. Start chatting!"))
        return
      }

      for (const [kind, count] of Object.entries(stats)) {
        console.log(`  ${chalk.cyan(kind)}: ${count}`)
      }
      console.log()
    }
  } finally {
    store.close()
  }
}
