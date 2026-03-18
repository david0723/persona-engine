import Database from "better-sqlite3"
import chalk from "chalk"
import { paths, ensurePersonaDir } from "../utils/config.js"
import { searchVault } from "../vault/search.js"
import { indexVault, initVaultIndex } from "../vault/indexer.js"
import { loadPersona } from "../persona/loader.js"

interface VaultSearchOptions {
  topK?: string
}

export async function vaultSearch(name: string, query: string, options: VaultSearchOptions): Promise<void> {
  const topK = parseInt(options.topK ?? "5", 10)

  // Load persona to get vault config
  let persona
  try {
    persona = loadPersona(name)
  } catch (err) {
    console.error(chalk.red((err as Error).message))
    process.exit(1)
  }

  if (!persona.vault?.enabled) {
    console.error(chalk.red(`Persona "${name}" does not have vault enabled.`))
    process.exit(1)
  }

  const dbPath = paths.memoryDb(name)
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("busy_timeout = 5000")
  initVaultIndex(db)

  // Check if index has any entries
  const count = (db.prepare("SELECT COUNT(*) as count FROM vault_index").get() as { count: number }).count
  if (count === 0) {
    console.log(chalk.yellow("Vault index is empty. Indexing now..."))
    const vaultPath = persona.vault.host_path ?? persona.vault.path ?? "/home/persona/vault"
    const result = await indexVault(vaultPath, db)
    console.log(chalk.dim(`Indexed ${result.indexed} files.`))
  }

  const results = await searchVault(query, db, topK)
  db.close()

  if (results.length === 0) {
    console.log(chalk.yellow("No results found."))
    return
  }

  console.log(chalk.bold(`\nTop ${results.length} results for "${query}":\n`))
  for (const r of results) {
    const score = (r.similarity * 100).toFixed(1)
    console.log(chalk.green(`[${score}%] ${r.project}/${r.title}`))
    console.log(chalk.dim(`  ${r.filePath}`))
    // Show first 120 chars of snippet
    const preview = r.snippet.replace(/\n/g, " ").slice(0, 120)
    console.log(chalk.dim(`  ${preview}...`))
    console.log()
  }
}

export async function vaultIndex(name: string): Promise<void> {
  let persona
  try {
    persona = loadPersona(name)
  } catch (err) {
    console.error(chalk.red((err as Error).message))
    process.exit(1)
  }

  if (!persona.vault?.enabled) {
    console.error(chalk.red(`Persona "${name}" does not have vault enabled.`))
    process.exit(1)
  }

  const vaultPath = persona.vault.host_path ?? persona.vault.path ?? "/home/persona/vault"
  const dbPath = paths.memoryDb(name)
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("busy_timeout = 5000")

  console.log(chalk.dim(`Indexing vault at ${vaultPath}...`))
  const result = await indexVault(vaultPath, db)
  db.close()

  console.log(chalk.green(`Done. Indexed ${result.indexed} files, skipped ${result.skipped} unchanged.`))
}
