import { execSync } from "node:child_process"
import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { loadPersonaEnv } from "../utils/config.js"
import { isDockerAvailable } from "../runtime/container.js"
import { generateComposeFile, getProjectDir } from "../runtime/compose-generator.js"
import { writeTunnelConfig, cleanupTunnelConfig } from "../telegram/tunnel.js"

interface DeployOptions {
  webhookUrl?: string
  port?: string
  withSupervisor?: boolean
}

export async function deployPersona(name: string, options: DeployOptions): Promise<void> {
  let persona
  try {
    persona = loadPersona(name)
  } catch (err) {
    console.error(chalk.red((err as Error).message))
    process.exit(1)
  }

  const port = parseInt(options.port ?? "3100", 10)

  if (!persona.telegram?.bot_token) {
    console.error(chalk.red(`No Telegram bot token configured for "${name}".`))
    process.exit(1)
  }

  if (!isDockerAvailable()) {
    console.error(chalk.red("Docker is not running. Start Docker Desktop or install Docker."))
    process.exit(1)
  }

  // Resolve webhook URL: explicit flag > tunnel config
  const personaEnv = loadPersonaEnv(name)
  const tunnelToken = personaEnv.CLOUDFLARE_TUNNEL_TOKEN ?? process.env.CLOUDFLARE_TUNNEL_TOKEN
  const tunnelConfig = persona.telegram?.tunnel

  let tunnelConfigDir: string | undefined
  let webhookUrl = options.webhookUrl

  if (!webhookUrl && tunnelToken && tunnelConfig) {
    // Use Cloudflare tunnel via compose
    const result = writeTunnelConfig(
      tunnelToken,
      tunnelConfig.hostname,
      `http://engine:${port}`,
    )
    tunnelConfigDir = result.dir
    webhookUrl = `https://${tunnelConfig.hostname}`
  }

  if (!webhookUrl) {
    console.error(chalk.red("No webhook URL available."))
    console.error(chalk.dim("Either pass --webhook-url or run `persona setup-telegram` first."))
    process.exit(1)
  }

  // Generate compose file using shared generator
  const composePath = generateComposeFile({
    name,
    persona,
    port,
    tunnelConfigDir,
    webhookUrl,
    detached: true,
  })

  const projectDir = getProjectDir()
  const projectName = `persona-${name}`
  const composeArgs = ["-p", projectName, "-f", composePath]

  console.log(chalk.dim("Building and starting containers..."))

  try {
    execSync(
      `docker compose ${composeArgs.join(" ")} up -d --build`,
      { cwd: projectDir, stdio: "inherit" },
    )
    console.log(chalk.green(`\n${persona.name} deployed successfully.`))
    console.log(chalk.dim(`Webhook URL: ${webhookUrl}/webhook/${name}`))
    console.log(chalk.dim(`Stop with: docker compose ${composeArgs.join(" ")} down`))

    if (tunnelConfigDir) {
      console.log(chalk.dim(`Tunnel config: ${tunnelConfigDir} (do not delete while running)`))
    }

    if (options.withSupervisor) {
      console.log(chalk.bold("\nSupervisor setup instructions:"))
      console.log(chalk.dim(`
1. Copy the service file:
   sudo cp ${projectDir}/supervisor/persona-supervisor.service /etc/systemd/system/

2. Edit the environment variables in the service file:
   sudo systemctl edit persona-supervisor

   Set PROJECT_DIR, COMPOSE_FILE, and SIGNAL_DIR for your deployment.

3. Enable and start:
   sudo systemctl daemon-reload
   sudo systemctl enable persona-supervisor
   sudo systemctl start persona-supervisor

4. Check logs:
   journalctl -u persona-supervisor -f
`))
    }
  } catch (err) {
    console.error(chalk.red(`Deployment failed: ${(err as Error).message}`))
    if (tunnelConfigDir) cleanupTunnelConfig(tunnelConfigDir)
    process.exit(1)
  }
}
