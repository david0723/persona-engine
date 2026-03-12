import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { runHeartbeat } from "../runtime/heartbeat-runner.js"

export async function heartbeatCommand(name: string): Promise<void> {
  try {
    const persona = loadPersona(name)

    if (!persona.heartbeat.enabled) {
      console.log(chalk.yellow(`Heartbeat is disabled for "${name}". Enable it in persona.yaml.`))
      return
    }

    console.log(chalk.dim(`Running heartbeat for ${persona.name}...`))
    await runHeartbeat(persona)
    console.log(chalk.green(`Heartbeat complete.`))
  } catch (err) {
    console.error(chalk.red((err as Error).message))
    process.exit(1)
  }
}
