import { readFileSync, writeFileSync, existsSync } from "node:fs"
import chalk from "chalk"
import { paths, ensurePersonaDir } from "../utils/config.js"
import { cloudflaredRun, ensureCloudflaredAuth } from "../utils/docker-cloudflared.js"
import { writeTunnelConfig } from "../telegram/tunnel.js"
import type { PersonaDefinition } from "../persona/schema.js"

export interface ReconcileResult {
  tunnelConfigDir?: string
  webhookUrl?: string
}

/**
 * Reconcile Telegram infrastructure to match persona YAML.
 *
 * If telegram config is present (bot_token + tunnel.hostname), provisions
 * tunnel, DNS, and token. If absent, decommissions existing infrastructure.
 */
export async function reconcileTelegram(
  name: string,
  persona: PersonaDefinition,
  port: number,
): Promise<ReconcileResult> {
  const telegram = persona.telegram
  const hasTelegram = telegram?.bot_token && telegram?.tunnel?.hostname

  if (hasTelegram) {
    return provisionTelegram(name, telegram!.tunnel!.hostname, port)
  }

  return decommissionTelegram(name)
}

function provisionTelegram(
  name: string,
  hostname: string,
  port: number,
): ReconcileResult {
  const tunnelName = `persona-${name}`

  // 1. Ensure cloudflared auth
  ensureCloudflaredAuth()

  // 2. Create tunnel (idempotent)
  ensureTunnel(tunnelName)

  // 3. Route DNS (idempotent)
  ensureDnsRoute(tunnelName, hostname)

  // 4. Get token, write to .env if needed
  const token = ensureTunnelToken(name, tunnelName)

  // 5. Write tunnel config for compose mount
  const result = writeTunnelConfig(token, hostname, `http://engine:${port}`)

  console.log(chalk.green(`Tunnel ready: https://${hostname}`))

  return {
    tunnelConfigDir: result.dir,
    webhookUrl: `https://${hostname}`,
  }
}

function decommissionTelegram(name: string): ReconcileResult {
  const tunnelName = `persona-${name}`

  if (tunnelExists(tunnelName)) {
    console.log(chalk.dim(`Removing tunnel "${tunnelName}"...`))
    try {
      cloudflaredRun(["tunnel", "cleanup", tunnelName])
    } catch { /* best effort */ }
    try {
      cloudflaredRun(["tunnel", "delete", tunnelName])
      console.log(chalk.dim(`Tunnel "${tunnelName}" deleted`))
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? ""
      if (!stderr.includes("not found")) {
        console.warn(chalk.yellow(`Could not delete tunnel: ${stderr.trim()}`))
      }
    }
  }

  removeTunnelTokenFromEnv(name)

  return { tunnelConfigDir: undefined, webhookUrl: undefined }
}

// --- Helpers ---

function tunnelExists(tunnelName: string): boolean {
  try {
    const output = cloudflaredRun(["tunnel", "list", "--output", "json"])
    const tunnels = JSON.parse(output) as Array<{ name: string }>
    return tunnels.some((t) => t.name === tunnelName)
  } catch {
    return false
  }
}

function ensureTunnel(tunnelName: string): void {
  console.log(chalk.dim(`Ensuring tunnel "${tunnelName}"...`))
  try {
    cloudflaredRun(["tunnel", "create", tunnelName])
    console.log(chalk.dim(`Tunnel "${tunnelName}" created`))
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? ""
    if (stderr.includes("already exists")) {
      console.log(chalk.dim(`Tunnel "${tunnelName}" already exists`))
    } else {
      throw err
    }
  }
}

function ensureDnsRoute(tunnelName: string, hostname: string): void {
  console.log(chalk.dim(`Ensuring DNS route for ${hostname}...`))
  try {
    cloudflaredRun(["tunnel", "route", "dns", tunnelName, hostname])
    console.log(chalk.dim(`DNS route created: ${hostname}`))
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? ""
    if (stderr.includes("already exists")) {
      console.log(chalk.dim(`DNS route for ${hostname} already exists`))
    } else {
      throw err
    }
  }
}

function ensureTunnelToken(name: string, tunnelName: string): string {
  const token = cloudflaredRun(["tunnel", "token", tunnelName]).trim()

  // Write to .env if missing or changed
  ensurePersonaDir(name)
  const envPath = paths.personaEnv(name)
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : ""

  const currentMatch = envContent.match(/CLOUDFLARE_TUNNEL_TOKEN=(.*)/)
  const currentToken = currentMatch?.[1]?.trim()

  if (currentToken !== token) {
    if (envContent.includes("CLOUDFLARE_TUNNEL_TOKEN=")) {
      envContent = envContent.replace(
        /CLOUDFLARE_TUNNEL_TOKEN=.*/g,
        `CLOUDFLARE_TUNNEL_TOKEN=${token}`,
      )
    } else {
      if (envContent.length > 0 && !envContent.endsWith("\n")) {
        envContent += "\n"
      }
      envContent += `\n# Cloudflare tunnel token for Telegram webhook\nCLOUDFLARE_TUNNEL_TOKEN=${token}\n`
    }
    writeFileSync(envPath, envContent)
    console.log(chalk.dim("Tunnel token updated in .env"))
  }

  return token
}

function removeTunnelTokenFromEnv(name: string): void {
  const envPath = paths.personaEnv(name)
  if (!existsSync(envPath)) return

  let content = readFileSync(envPath, "utf-8")
  if (!content.includes("CLOUDFLARE_TUNNEL_TOKEN=")) return

  content = content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed !== "# Cloudflare tunnel token for Telegram webhook" &&
        !trimmed.startsWith("CLOUDFLARE_TUNNEL_TOKEN=")
    })
    .join("\n")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n"

  writeFileSync(envPath, content)
  console.log(chalk.dim("Tunnel token removed from .env"))
}
