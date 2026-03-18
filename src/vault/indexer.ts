import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, basename, dirname } from "node:path"
import type Database from "better-sqlite3"
import { embed } from "./embeddings.js"

const SNIPPET_LENGTH = 500
const IGNORED_DIRS = new Set([".obsidian", ".trash", ".stversions", ".stfolder"])
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"])

/**
 * Initialize the vault_index table in the given database.
 */
export function initVaultIndex(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_index (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      project TEXT NOT NULL,
      title TEXT,
      snippet TEXT,
      embedding BLOB NOT NULL,
      mtime INTEGER NOT NULL,
      indexed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vault_project ON vault_index(project);
  `)
}

/**
 * Walk the vault and index all markdown/text files.
 * Incremental: skips files whose mtime hasn't changed.
 */
export async function indexVault(vaultPath: string, db: Database.Database): Promise<{ indexed: number; skipped: number }> {
  initVaultIndex(db)

  const getMtime = db.prepare("SELECT mtime FROM vault_index WHERE file_path = ?")
  const upsert = db.prepare(`
    INSERT INTO vault_index (file_path, project, title, snippet, embedding, mtime)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      project = excluded.project,
      title = excluded.title,
      snippet = excluded.snippet,
      embedding = excluded.embedding,
      mtime = excluded.mtime,
      indexed_at = datetime('now')
  `)
  const removeStale = db.prepare("DELETE FROM vault_index WHERE file_path = ?")

  const files = walkVault(vaultPath)
  const seenPaths = new Set<string>()
  let indexed = 0
  let skipped = 0

  for (const filePath of files) {
    const relPath = relative(vaultPath, filePath)
    seenPaths.add(relPath)

    const stat = statSync(filePath)
    const mtime = Math.floor(stat.mtimeMs)

    // Skip unchanged files
    const existing = getMtime.get(relPath) as { mtime: number } | undefined
    if (existing && existing.mtime === mtime) {
      skipped++
      continue
    }

    const content = readFileSync(filePath, "utf-8")
    const project = relPath.split("/")[0]
    const title = extractTitle(content, basename(filePath))
    const snippet = content.slice(0, SNIPPET_LENGTH)

    const textToEmbed = `${title}\n${snippet}`
    const vector = await embed(textToEmbed)
    const embeddingBlob = Buffer.from(vector.buffer)

    upsert.run(relPath, project, title, snippet, embeddingBlob, mtime)
    indexed++
  }

  // Remove entries for deleted files
  const allIndexed = db.prepare("SELECT file_path FROM vault_index").all() as { file_path: string }[]
  for (const row of allIndexed) {
    if (!seenPaths.has(row.file_path)) {
      removeStale.run(row.file_path)
    }
  }

  return { indexed, skipped }
}

function walkVault(dir: string): string[] {
  const results: string[] = []

  function walk(current: string) {
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue

      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (SUPPORTED_EXTENSIONS.has(getExtension(entry.name))) {
        results.push(fullPath)
      }
    }
  }

  walk(dir)
  return results
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".")
  return dot === -1 ? "" : filename.slice(dot)
}

function extractTitle(content: string, filename: string): string {
  // Try first heading
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()

  // Try YAML frontmatter name
  const fmMatch = content.match(/^---\n[\s\S]*?^name:\s*(.+)$/m)
  if (fmMatch) return fmMatch[1].trim()

  // Fall back to filename without extension
  return filename.replace(/\.[^.]+$/, "")
}
