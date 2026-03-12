import { readdirSync, existsSync, statSync } from "node:fs"
import chalk from "chalk"
import { paths } from "../utils/config.js"
import { loadPersona } from "../persona/loader.js"

export async function listPersonas(): Promise<void> {
  const personasDir = paths.personas

  if (!existsSync(personasDir)) {
    console.log(chalk.dim("No personas yet. Create one with: persona create <name>"))
    return
  }

  const entries = readdirSync(personasDir, { withFileTypes: true })
    .filter(e => e.isDirectory())

  if (entries.length === 0) {
    console.log(chalk.dim("No personas yet. Create one with: persona create <name>"))
    return
  }

  console.log(chalk.bold("Personas:\n"))

  for (const entry of entries) {
    try {
      const persona = loadPersona(entry.name)
      const yamlPath = paths.personaYaml(entry.name)
      const lastModified = statSync(yamlPath).mtime.toLocaleDateString()

      const heartbeatStatus = persona.heartbeat.enabled
        ? chalk.green(`every ${persona.heartbeat.interval_minutes}m`)
        : chalk.dim("off")

      console.log(`  ${chalk.bold(persona.name)}`)
      console.log(`    ${chalk.dim(persona.identity.role)}`)
      console.log(`    Heartbeat: ${heartbeatStatus}  |  Modified: ${lastModified}`)
      console.log()
    } catch {
      console.log(`  ${chalk.yellow(entry.name)} ${chalk.red("(invalid)")}`)
      console.log()
    }
  }
}
