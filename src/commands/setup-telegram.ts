import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import chalk from "chalk"
import { parse, stringify } from "yaml"
import { paths, ensurePersonaDir } from "../utils/config.js"
import { personaExists } from "../persona/loader.js"
import { cloudflaredRun, ensureCloudflaredAuth } from "../utils/docker-cloudflared.js"

const DEFAULT_DOMAIN = "davidkarolina.com"

interface SetupTelegramOptions {
  domain?: string
}

export async function setupTelegram(name: string, options: SetupTelegramOptions): Promise<void> {
  const domain = options.domain ?? DEFAULT_DOMAIN
  const hostname = `${name}.${domain}`
  const tunnelName = `persona-${name}`

  // 1. Validate persona exists
  if (!personaExists(name)) {
    console.error(chalk.red(`Persona "${name}" not found. Create it first: persona create ${name}`))
    process.exit(1)
  }

  // 2. Ensure cloudflared is authenticated (via Docker)
  try {
    ensureCloudflaredAuth()
  } catch (err) {
    console.error(chalk.red((err as Error).message))
    process.exit(1)
  }

  // 3. Verify auth works by listing tunnels
  try {
    cloudflaredRun(["tunnel", "list"])
  } catch {
    console.error(chalk.red("cloudflared authentication failed."))
    console.error(chalk.dim("Try removing ~/.cloudflared/cert.pem and running setup again."))
    process.exit(1)
  }

  // 4. Create tunnel (skip if already exists)
  console.log(chalk.dim(`Creating tunnel "${tunnelName}"...`))
  try {
    cloudflaredRun(["tunnel", "create", tunnelName])
    console.log(chalk.green(`Tunnel "${tunnelName}" created`))
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? ""
    if (stderr.includes("already exists")) {
      console.log(chalk.dim(`Tunnel "${tunnelName}" already exists, reusing it`))
    } else {
      console.error(chalk.red(`Failed to create tunnel: ${stderr.trim()}`))
      process.exit(1)
    }
  }

  // 5. Route DNS (skip if already exists)
  console.log(chalk.dim(`Routing ${hostname} to tunnel...`))
  try {
    cloudflaredRun(["tunnel", "route", "dns", tunnelName, hostname])
    console.log(chalk.green(`DNS route created: ${hostname}`))
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? ""
    if (stderr.includes("already exists")) {
      console.log(chalk.dim(`DNS route for ${hostname} already exists`))
    } else {
      console.error(chalk.red(`Failed to route DNS: ${stderr.trim()}`))
      process.exit(1)
    }
  }

  // 6. Get tunnel token
  console.log(chalk.dim("Retrieving tunnel token..."))
  let token: string
  try {
    token = cloudflaredRun(["tunnel", "token", tunnelName]).trim()
  } catch (err) {
    console.error(chalk.red(`Failed to get tunnel token: ${(err as Error).message}`))
    process.exit(1)
  }

  // 7. Write token to persona .env
  ensurePersonaDir(name)
  const envPath = paths.personaEnv(name)
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : ""

  if (envContent.includes("CLOUDFLARE_TUNNEL_TOKEN=")) {
    // Replace existing token
    envContent = envContent.replace(/CLOUDFLARE_TUNNEL_TOKEN=.*/g, `CLOUDFLARE_TUNNEL_TOKEN=${token}`)
  } else {
    // Append
    if (envContent.length > 0 && !envContent.endsWith("\n")) {
      envContent += "\n"
    }
    envContent += `\n# Cloudflare tunnel token for Telegram webhook\nCLOUDFLARE_TUNNEL_TOKEN=${token}\n`
  }
  writeFileSync(envPath, envContent)
  console.log(chalk.green("Tunnel token saved to .env"))

  // 8. Update persona.yaml
  const yamlPath = paths.personaYaml(name)
  const raw = readFileSync(yamlPath, "utf-8")
  const config = parse(raw) as Record<string, unknown>

  // Ensure telegram section exists
  if (!config.telegram || typeof config.telegram !== "object") {
    config.telegram = { enabled: true }
  }

  const telegram = config.telegram as Record<string, unknown>
  telegram.enabled = true

  // Set tunnel hostname
  telegram.tunnel = { hostname }

  // Remove old tunnel.name if present
  const tunnel = telegram.tunnel as Record<string, unknown>
  delete tunnel.name

  // 9. Prompt for bot token if not set
  if (!telegram.bot_token) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    console.log(chalk.dim("\nNo bot token configured. Create one via @BotFather on Telegram."))
    const botToken = await rl.question(chalk.bold("Enter your Telegram bot token: "))
    rl.close()

    if (botToken.trim()) {
      telegram.bot_token = botToken.trim()
    } else {
      console.log(chalk.dim("Skipped. Add it later in persona.yaml under telegram.bot_token"))
    }
  }

  writeFileSync(yamlPath, stringify(config, { lineWidth: 0 }))
  console.log(chalk.green("persona.yaml updated"))

  // 10. Summary
  console.log(chalk.bold("\nTelegram setup complete:\n"))
  console.log(`  Tunnel:   ${tunnelName}`)
  console.log(`  Hostname: ${hostname}`)
  console.log(`  Webhook:  https://${hostname}/webhook/${name}`)
  console.log(`  Token:    stored in ${envPath}`)

  if (telegram.bot_token) {
    console.log(chalk.green(`\nRun ${chalk.bold(`persona serve ${name}`)} to start.`))
  } else {
    console.log(chalk.yellow(`\nAdd your bot token to persona.yaml, then run ${chalk.bold(`persona serve ${name}`)}`))
  }
}
