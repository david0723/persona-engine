import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { loadPersonaEnv } from "../utils/config.js"

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

  const port = options.port ?? "3100"
  const webhookUrl = options.webhookUrl

  if (!webhookUrl) {
    console.error(chalk.red("--webhook-url is required for deployment."))
    console.error(chalk.dim("Example: persona deploy my-bot --webhook-url https://my-domain.com"))
    process.exit(1)
  }

  if (!persona.telegram?.bot_token) {
    console.error(chalk.red(`No Telegram bot token configured for "${name}".`))
    process.exit(1)
  }

  // Generate a deployment-specific compose file
  const projectDir = join(import.meta.dirname, "..", "..")
  const containerConfig = persona.container ?? { enabled: false }
  const networkMode = containerConfig.network ?? "none"
  const memoryLimit = containerConfig.memory_limit ?? "512M"
  const cpuLimit = containerConfig.cpu_limit ?? "1.0"

  // Build environment variables from the persona's own .env file
  const personaEnv = loadPersonaEnv(name)
  const environment: string[] = [
    "PERSONA_ENGINE_CONTAINERIZED=true",
    `WEBHOOK_URL=${webhookUrl}`,
  ]

  // Inject all vars from the persona's .env
  for (const [key, value] of Object.entries(personaEnv)) {
    environment.push(`${key}=${value}`)
  }

  // Inject repo URL from self_update config if not already in .env
  const selfUpdate = persona.self_update
  if (selfUpdate?.enabled && selfUpdate.repo_url && !personaEnv.PERSONA_ENGINE_REPO_URL) {
    environment.push(`PERSONA_ENGINE_REPO_URL=${selfUpdate.repo_url}`)
  }

  const service: Record<string, unknown> = {
    build: ".",
    command: ["serve", name, "--no-cli", "--port", port],
    volumes: [
      "persona-data:/home/persona/.persona-engine",
      ...(selfUpdate?.enabled ? ["persona-workspace:/home/persona/workspace"] : []),
    ],
    ports: [`${port}:${port}`],
    environment,
    network_mode: networkMode,
    read_only: true,
    tmpfs: ["/tmp"],
    deploy: {
      resources: {
        limits: {
          memory: memoryLimit,
          cpus: cpuLimit,
        },
      },
    },
    restart: "unless-stopped",
  }

  const volumes: Record<string, Record<string, never>> = { "persona-data": {} }
  if (selfUpdate?.enabled) {
    volumes["persona-workspace"] = {}
  }

  const composeOverride = {
    services: { persona: service },
    volumes,
  }

  const composePath = join(projectDir, `docker-compose.${name}.yml`)
  writeFileSync(composePath, JSON.stringify(composeOverride, null, 2), "utf-8")

  console.log(chalk.dim(`Generated ${composePath}`))
  console.log(chalk.dim("Building and starting container..."))

  try {
    execSync(`docker compose -f "${composePath}" up -d --build`, {
      cwd: projectDir,
      stdio: "inherit",
    })
    console.log(chalk.green(`\n${persona.name} deployed successfully.`))
    console.log(chalk.dim(`Webhook URL: ${webhookUrl}/webhook/${name}`))
    console.log(chalk.dim(`Stop with: docker compose -f "${composePath}" down`))

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
    process.exit(1)
  }
}
