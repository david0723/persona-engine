import { writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import chalk from "chalk"
import { paths, ensurePersonaDir } from "../utils/config.js"
import { defaultPersonaYaml } from "../persona/defaults.js"
import { personaExists } from "../persona/loader.js"

export async function createPersona(name: string): Promise<void> {
  if (personaExists(name)) {
    console.error(chalk.red(`Persona "${name}" already exists.`))
    process.exit(1)
  }

  ensurePersonaDir(name)

  const yamlPath = paths.personaYaml(name)
  writeFileSync(yamlPath, defaultPersonaYaml(name), "utf-8")

  console.log(chalk.green(`Created persona "${name}" at ${yamlPath}`))

  const editor = process.env.EDITOR
  if (editor) {
    console.log(chalk.dim(`Opening in ${editor}...`))
    try {
      execSync(`${editor} "${yamlPath}"`, { stdio: "inherit" })
    } catch {
      console.log(chalk.dim("Editor closed."))
    }
  } else {
    console.log(chalk.dim(`Edit the file to customize your persona's identity.`))
  }
}
