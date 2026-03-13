import { renameSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import chalk from "chalk"
import { parse, stringify } from "yaml"
import { paths } from "../utils/config.js"
import { personaExists } from "../persona/loader.js"
import { socketPath } from "../runtime/ipc-server.js"
import { cloudflaredRun } from "../utils/docker-cloudflared.js"

export async function renamePersona(oldName: string, newName: string): Promise<void> {
  // 1. Validate
  if (!personaExists(oldName)) {
    console.error(chalk.red(`Persona "${oldName}" not found.`))
    process.exit(1)
  }

  if (personaExists(newName)) {
    console.error(chalk.red(`Persona "${newName}" already exists.`))
    process.exit(1)
  }

  const sockPath = socketPath(oldName)
  if (existsSync(sockPath)) {
    console.error(chalk.red(`Persona "${oldName}" is running. Stop it first.`))
    process.exit(1)
  }

  // 2. Rename data directory
  const oldDir = paths.personaDir(oldName)
  const newDir = paths.personaDir(newName)
  renameSync(oldDir, newDir)
  console.log(chalk.dim(`Renamed ${oldDir} -> ${newDir}`))

  // 3. Update name in persona.yaml
  const yamlPath = paths.personaYaml(newName)
  const raw = readFileSync(yamlPath, "utf-8")
  const config = parse(raw) as Record<string, unknown>
  config.name = newName

  // 4. Update tunnel hostname if it matches old name pattern
  const telegram = config.telegram as Record<string, unknown> | undefined
  const tunnel = telegram?.tunnel as Record<string, string> | undefined
  let oldHostname: string | undefined
  let newHostname: string | undefined

  if (tunnel?.hostname) {
    const hostnameRegex = new RegExp(`^${oldName}\\.(.+)$`)
    const match = tunnel.hostname.match(hostnameRegex)
    if (match) {
      oldHostname = tunnel.hostname
      newHostname = `${newName}.${match[1]}`
      tunnel.hostname = newHostname
      console.log(chalk.dim(`Updated tunnel hostname: ${oldHostname} -> ${newHostname}`))
    }
  }

  writeFileSync(yamlPath, stringify(config, { lineWidth: 0 }))
  console.log(chalk.dim("Updated persona.yaml"))

  // 5. Migrate tunnel infrastructure if it exists
  const oldTunnelName = `persona-${oldName}`
  const newTunnelName = `persona-${newName}`

  if (newHostname) {
    try {
      await migrateTunnel(oldName, newName, oldTunnelName, newTunnelName, newHostname)
    } catch (err) {
      console.warn(chalk.yellow(`Tunnel migration skipped: ${(err as Error).message}`))
      console.warn(chalk.dim(`Run 'persona start ${newName}' to reconcile infrastructure.`))
    }
  }

  // Summary
  console.log(chalk.green(`\nRenamed "${oldName}" -> "${newName}"`))
  console.log(chalk.dim(`Start with: persona start ${newName}`))
}

async function migrateTunnel(
  oldName: string,
  newName: string,
  oldTunnelName: string,
  newTunnelName: string,
  newHostname: string,
): Promise<void> {
  // Check if old tunnel exists
  let oldExists = false
  try {
    const output = cloudflaredRun(["tunnel", "list", "--output", "json"])
    const tunnels = JSON.parse(output) as Array<{ name: string }>
    oldExists = tunnels.some((t) => t.name === oldTunnelName)
  } catch {
    return // cloudflared not available, skip
  }

  if (!oldExists) return

  console.log(chalk.dim("Migrating tunnel infrastructure..."))

  // Create new tunnel
  try {
    cloudflaredRun(["tunnel", "create", newTunnelName])
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? ""
    if (!stderr.includes("already exists")) throw err
  }

  // Route DNS for new hostname
  try {
    cloudflaredRun(["tunnel", "route", "dns", newTunnelName, newHostname])
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? ""
    if (!stderr.includes("already exists")) throw err
  }

  // Get new token and write to .env
  const token = cloudflaredRun(["tunnel", "token", newTunnelName]).trim()
  const envPath = paths.personaEnv(newName)
  if (existsSync(envPath)) {
    let envContent = readFileSync(envPath, "utf-8")
    if (envContent.includes("CLOUDFLARE_TUNNEL_TOKEN=")) {
      envContent = envContent.replace(
        /CLOUDFLARE_TUNNEL_TOKEN=.*/g,
        `CLOUDFLARE_TUNNEL_TOKEN=${token}`,
      )
      writeFileSync(envPath, envContent)
    }
  }

  // Cleanup and delete old tunnel
  try { cloudflaredRun(["tunnel", "cleanup", oldTunnelName]) } catch { /* best effort */ }
  try { cloudflaredRun(["tunnel", "delete", oldTunnelName]) } catch { /* best effort */ }

  console.log(chalk.dim(`Tunnel migrated: ${oldTunnelName} -> ${newTunnelName}`))
}
