import type Database from "better-sqlite3"
import { embed, cosineSimilarity } from "./embeddings.js"

export interface SearchResult {
  filePath: string
  project: string
  title: string
  snippet: string
  similarity: number
}

/**
 * Search the vault index for files semantically similar to the query.
 * Returns top-K results sorted by cosine similarity.
 */
export async function searchVault(
  query: string,
  db: Database.Database,
  topK: number = 5,
): Promise<SearchResult[]> {
  const queryVector = await embed(query)

  const rows = db.prepare(
    "SELECT file_path, project, title, snippet, embedding FROM vault_index"
  ).all() as Array<{
    file_path: string
    project: string
    title: string
    snippet: string
    embedding: Buffer
  }>

  const scored: SearchResult[] = rows.map(row => {
    const storedVector = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    )
    return {
      filePath: row.file_path,
      project: row.project,
      title: row.title,
      snippet: row.snippet,
      similarity: cosineSimilarity(queryVector, storedVector),
    }
  })

  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, topK)
}
