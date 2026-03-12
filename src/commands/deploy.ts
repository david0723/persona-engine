import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"

interface DeployOptions {
  webhookUrl?: string
  port?: string
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

  // Build environment variables list
  const environment: string[] = [
    "PERSONA_ENGINE_CONTAINERIZED=true",
    `WEBHOOK_URL=${webhookUrl}`,
  ]

  if (containerConfig.allowed_env && containerConfig.allowed_env.length > 0) {
    // Only pass through explicitly allowed env vars
    for (const envName of containerConfig.allowed_env) {
      const value = process.env[envName]
      if (value) {
        environment.push(`${envName}=${value}`)
      }
    }
  } else {
    // Default: pass through common API keys
    environment.push(
      `OPENCODE_API_KEY=${process.env.OPENCODE_API_KEY ?? ""}`,
      `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ""}`,
      `OPENAI_API_KEY=${process.env.OPENAI_API_KEY ?? ""}`,
    )
  }

  const service: Record<string, unknown> = {
    build: ".",
    command: ["serve", name, "--no-cli", "--port", port],
    volumes: ["persona-data:/home/persona/.persona-engine"],
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

  const composeOverride = {
    services: { persona: service },
    volumes: { "persona-data": {} },
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
  } catch (err) {
    console.error(chalk.red(`Deployment failed: ${(err as Error).message}`))
    process.exit(1)
  }
}
