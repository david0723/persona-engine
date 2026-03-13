import { existsSync } from "node:fs"
import chalk from "chalk"
import { socketPath } from "../runtime/ipc-server.js"
import { connectToPersona } from "../runtime/ipc-client.js"

export async function attachToPersona(name: string): Promise<void> {
  const sockPath = socketPath(name)

  if (!existsSync(sockPath)) {
    console.error(chalk.red(`No running instance of "${name}" found.`))
    console.error(chalk.dim(`Start it first: persona start ${name}`))
    process.exit(1)
  }

  connectToPersona(name)
}
