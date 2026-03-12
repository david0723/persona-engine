import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { paths, ensurePersonaDir } from "../utils/config.js"
import { estimateTokens } from "../utils/token-budget.js"
import type { Memory, MemoryKind } from "./types.js"

export class MemoryStore {
  private db: Database.Database

  constructor(personaName: string) {
    ensurePersonaDir(personaName)
    this.db = new Database(paths.memoryDb(personaName))
    this.db.pragma("journal_mode = WAL")
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT,
        importance INTEGER DEFAULT 5,
        token_estimate INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
    `)
  }

  addTurn(sessionId: string, role: string, content: string, source: string = "cli"): void {
    const fullContent = `[${role}]: ${content}`
    this.db.prepare(`
      INSERT INTO memories (id, kind, content, session_id, importance, token_estimate)
      VALUES (?, 'conversation_turn', ?, ?, 3, ?)
    `).run(randomUUID(), fullContent, sessionId, estimateTokens(fullContent))
  }

  addMemory(kind: MemoryKind, content: string, importance: number = 5, sessionId: string | null = null): string {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO memories (id, kind, content, session_id, importance, token_estimate)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, kind, content, sessionId, importance, estimateTokens(content))
    return id
  }

  getRecentTurns(sessionId: string, limit: number = 50): Memory[] {
    return this.db.prepare(`
      SELECT * FROM memories
      WHERE kind = 'conversation_turn' AND session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(sessionId, limit) as Memory[]
  }

  getByKind(kind: MemoryKind, limit: number = 10): Memory[] {
    return this.db.prepare(`
      SELECT * FROM memories
      WHERE kind = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(kind, limit) as Memory[]
  }

  getTopImportance(limit: number = 20, tokenBudget: number = 3000): Memory[] {
    const memories = this.db.prepare(`
      SELECT * FROM memories
      WHERE kind IN ('core_memory', 'relationship_note')
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `).all(limit) as Memory[]

    let totalTokens = 0
    const result: Memory[] = []
    for (const m of memories) {
      if (totalTokens + m.token_estimate > tokenBudget) break
      result.push(m)
      totalTokens += m.token_estimate
    }
    return result
  }

  getSessionIds(limit: number = 5): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT session_id FROM memories
      WHERE session_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as { session_id: string }[]
    return rows.map(r => r.session_id)
  }

  getTurnsBySession(sessionId: string): Memory[] {
    return this.db.prepare(`
      SELECT * FROM memories
      WHERE kind = 'conversation_turn' AND session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId) as Memory[]
  }

  deleteTurnsForSession(sessionId: string): void {
    this.db.prepare(`
      DELETE FROM memories WHERE kind = 'conversation_turn' AND session_id = ?
    `).run(sessionId)
  }

  stats(): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT kind, COUNT(*) as count FROM memories GROUP BY kind
    `).all() as { kind: string; count: number }[]

    const result: Record<string, number> = {}
    for (const row of rows) {
      result[row.kind] = row.count
    }
    return result
  }

  close(): void {
    this.db.close()
  }
}
