import { writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import chalk from "chalk"
import { paths, ensurePersonaDir } from "../utils/config.js"
import { defaultPersonaYaml, architectPersonaYaml, orchestratorPersonaYaml } from "../persona/defaults.js"
import { personaExists } from "../persona/loader.js"

interface CreateOptions {
  template?: string
}

const TEMPLATES: Record<string, (name: string) => string> = {
  default: defaultPersonaYaml,
  architect: architectPersonaYaml,
  orchestrator: orchestratorPersonaYaml,
}

export async function createPersona(name: string, options: CreateOptions = {}): Promise<void> {
  if (personaExists(name)) {
    console.error(chalk.red(`Persona "${name}" already exists.`))
    process.exit(1)
  }

  const templateName = options.template ?? "default"
  const templateFn = TEMPLATES[templateName]

  if (!templateFn) {
    console.error(chalk.red(`Unknown template "${templateName}".`))
    console.error(chalk.dim(`Available templates: ${Object.keys(TEMPLATES).join(", ")}`))
    process.exit(1)
  }

  ensurePersonaDir(name)

  const yamlPath = paths.personaYaml(name)
  writeFileSync(yamlPath, templateFn(name), "utf-8")

  console.log(chalk.green(`Created persona "${name}" at ${yamlPath}`))
  if (templateName !== "default") {
    console.log(chalk.dim(`Using template: ${templateName}`))
  }

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
