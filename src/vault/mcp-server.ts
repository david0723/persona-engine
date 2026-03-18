#!/usr/bin/env node
/**
 * MCP (Model Context Protocol) server for vault search.
 * Exposes vault semantic search as a native tool in OpenCode.
 *
 * Usage: Register in opencode.json mcp config:
 *   "vault-search": {
 *     "type": "local",
 *     "command": ["node", "/path/to/dist/vault/mcp-server.js"]
 *   }
 *
 * Environment variables:
 *   VAULT_PATH - Path to the Obsidian vault (required)
 *   VAULT_DB_PATH - Path to the SQLite database (required)
 */

import { createInterface } from "node:readline"
import BetterSqlite3 from "better-sqlite3"
import { searchVault } from "./search.js"
import { indexVault, initVaultIndex } from "./indexer.js"

const VAULT_PATH = process.env.VAULT_PATH
const DB_PATH = process.env.VAULT_DB_PATH

if (!VAULT_PATH || !DB_PATH) {
  process.stderr.write("VAULT_PATH and VAULT_DB_PATH environment variables are required\n")
  process.exit(1)
}

const db = BetterSqlite3(DB_PATH)
db.pragma("journal_mode = WAL")
initVaultIndex(db)

// JSON-RPC over stdio
const rl = createInterface({ input: process.stdin })

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: unknown
}

function respond(id: number | string, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result })
  process.stdout.write(`${msg}\n`)
}

function respondError(id: number | string, code: number, message: string): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })
  process.stdout.write(`${msg}\n`)
}

const TOOLS = [
  {
    name: "vault_search",
    description: "Search the Obsidian vault for files semantically related to the query. Returns top results with similarity scores and content snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query - describe what you're looking for",
        },
        topK: {
          type: "number",
          description: "Number of results to return (default: 5, max: 20)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "vault_reindex",
    description: "Reindex the vault to pick up new or changed files. Run this if search results seem stale.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
]

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  switch (req.method) {
    case "initialize": {
      respond(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "vault-search", version: "1.0.0" },
      })
      break
    }

    case "notifications/initialized": {
      // No response needed for notifications
      break
    }

    case "tools/list": {
      respond(req.id, { tools: TOOLS })
      break
    }

    case "tools/call": {
      const params = req.params as { name: string; arguments?: Record<string, unknown> }

      if (params.name === "vault_search") {
        const args = params.arguments ?? {}
        const query = args.query as string
        if (!query) {
          respondError(req.id, -32602, "query parameter is required")
          return
        }
        const topK = Math.min(Math.max((args.topK as number) ?? 5, 1), 20)

        try {
          const results = await searchVault(query, db, topK)
          const text = results.length === 0
            ? "No results found."
            : results.map(r =>
              `[${(r.similarity * 100).toFixed(0)}%] ${r.filePath}\n  Title: ${r.title}\n  Snippet: ${r.snippet.slice(0, 150).replace(/\n/g, " ")}...`
            ).join("\n\n")

          respond(req.id, {
            content: [{ type: "text", text }],
          })
        } catch (err) {
          respond(req.id, {
            content: [{ type: "text", text: `Search error: ${(err as Error).message}` }],
            isError: true,
          })
        }
      } else if (params.name === "vault_reindex") {
        try {
          const result = await indexVault(VAULT_PATH!, db)
          respond(req.id, {
            content: [{ type: "text", text: `Reindexed: ${result.indexed} files updated, ${result.skipped} unchanged.` }],
          })
        } catch (err) {
          respond(req.id, {
            content: [{ type: "text", text: `Reindex error: ${(err as Error).message}` }],
            isError: true,
          })
        }
      } else {
        respondError(req.id, -32601, `Unknown tool: ${params.name}`)
      }
      break
    }

    default: {
      respondError(req.id, -32601, `Method not found: ${req.method}`)
    }
  }
}

rl.on("line", (line) => {
  try {
    const req = JSON.parse(line) as JsonRpcRequest
    handleRequest(req).catch(err => {
      respondError(req.id, -32603, (err as Error).message)
    })
  } catch {
    // Ignore malformed JSON
  }
})

process.on("SIGTERM", () => {
  db.close()
  process.exit(0)
})
