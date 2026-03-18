/**
 * OpenCode plugin for vault integration.
 *
 * Provides:
 * 1. vault_search tool - semantic search across the vault
 * 2. vault_reindex tool - trigger re-indexing
 * 3. Compaction hook - injects vault context when sessions are compacted
 *
 * Register in opencode.json:
 *   "plugin": { "vault": "./path/to/opencode-plugin.js" }
 *
 * Environment variables:
 *   VAULT_PATH - Path to the Obsidian vault
 *   VAULT_DB_PATH - Path to the SQLite database
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tool, type Plugin } from "@opencode-ai/plugin"
import BetterSqlite3 from "better-sqlite3"
import { searchVault } from "./search.js"
import { indexVault, initVaultIndex } from "./indexer.js"

export const VaultPlugin: Plugin = async (ctx) => {
  const vaultPath = process.env.VAULT_PATH
  const dbPath = process.env.VAULT_DB_PATH

  if (!vaultPath || !dbPath) {
    console.warn("[vault-plugin] VAULT_PATH and VAULT_DB_PATH required, plugin disabled")
    return {}
  }

  const db = BetterSqlite3(dbPath)
  db.pragma("journal_mode = WAL")
  initVaultIndex(db)

  return {
    // Native vault search tool
    tool: {
      "vault_search": tool({
        description: "Search the Obsidian vault for files semantically related to the query. Returns top results with similarity scores and content snippets.",
        args: {
          query: tool.schema.string().describe("The search query - describe what you're looking for"),
          topK: tool.schema.number().optional().describe("Number of results (default: 5, max: 20)"),
        },
        async execute(args) {
          const topK = Math.min(Math.max(args.topK ?? 5, 1), 20)
          const results = await searchVault(args.query, db, topK)

          if (results.length === 0) return "No results found."

          return results.map(r =>
            `[${(r.similarity * 100).toFixed(0)}%] ${r.filePath}\n  Title: ${r.title}\n  Snippet: ${r.snippet.slice(0, 150).replace(/\n/g, " ")}...`
          ).join("\n\n")
        },
      }),

      "vault_reindex": tool({
        description: "Reindex the vault to pick up new or changed files. Run this if search results seem stale.",
        args: {},
        async execute() {
          const result = await indexVault(vaultPath, db)
          return `Reindexed: ${result.indexed} files updated, ${result.skipped} unchanged.`
        },
      }),
    },

    // Compaction hook: inject vault context when sessions get compressed
    "experimental.session.compacting": async (_input, output) => {
      const contextParts: string[] = []

      // Inject user preferences
      const prefsPath = join(vaultPath, "Preferences", "preferences.md")
      if (existsSync(prefsPath)) {
        try {
          const prefs = readFileSync(prefsPath, "utf-8")
          contextParts.push(`## User Preferences (always follow these)\n${prefs}`)
        } catch { /* skip */ }
      }

      // Inject vault INDEX.md for project awareness
      const indexPath = join(vaultPath, "INDEX.md")
      if (existsSync(indexPath)) {
        try {
          const index = readFileSync(indexPath, "utf-8")
          contextParts.push(`## Vault Projects\n${index}`)
        } catch { /* skip */ }
      }

      // Inject today's dashboard if it exists
      const dashboardPath = join(vaultPath, "Dashboard.md")
      if (existsSync(dashboardPath)) {
        try {
          const dashboard = readFileSync(dashboardPath, "utf-8")
          contextParts.push(`## Current Dashboard\n${dashboard}`)
        } catch { /* skip */ }
      }

      if (contextParts.length > 0) {
        output.context.push(contextParts.join("\n\n---\n\n"))
      }
    },
  }
}

export default VaultPlugin
