import { execSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, watchFile, unwatchFile } from "node:fs"
import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { loadPersonaEnv } from "../utils/config.js"
import { isContainerized, isDockerAvailable } from "../runtime/container.js"
import { generateComposeFile, getProjectDir } from "../runtime/compose-generator.js"
import { writeTunnelConfig, cleanupTunnelConfig } from "../telegram/tunnel.js"
import { connectToPersona } from "../runtime/ipc-client.js"
import { socketPath } from "../runtime/ipc-server.js"

interface ServeOptions {
  port?: string
  cli?: boolean  // --no-cli sets this to false
}

export async function servePersona(name: string, options: ServeOptions): Promise<void> {
  const port = parseInt(options.port ?? "3100", 10)

  // 1. Load persona config
  let persona
  try {
    persona = loadPersona(name)
  } catch (err) {
    console.error(chalk.red((err as Error).message))
    process.exit(1)
  }

  // If running inside a container, start the in-container server
  if (isContainerized()) {
    const { startContainerServer } = await import("../runtime/container-server.js")
    await startContainerServer(name, port)
    return
  }

  const token = persona.telegram?.bot_token
  if (!token) {
    console.log(chalk.dim(`No Telegram bot token configured for "${name}". Running in IPC/CLI mode only.`))
  }

  // 2. Ensure Docker is available
  if (!isDockerAvailable()) {
    console.error(chalk.red("Docker is not running. Start Docker Desktop or install Docker."))
    process.exit(1)
  }

  // 3. Resolve tunnel config
  const personaEnv = loadPersonaEnv(name)
  const tunnelToken = personaEnv.CLOUDFLARE_TUNNEL_TOKEN ?? process.env.CLOUDFLARE_TUNNEL_TOKEN
  const tunnelConfig = persona.telegram?.tunnel

  let tunnelConfigDir: string | undefined
  let webhookUrl: string | undefined

  if (tunnelToken && tunnelConfig) {
    console.log(chalk.dim(`Writing tunnel config for ${tunnelConfig.hostname}...`))
    const result = writeTunnelConfig(
      tunnelToken,
      tunnelConfig.hostname,
      `http://engine:${port}`,
    )
    tunnelConfigDir = result.dir
    webhookUrl = `https://${tunnelConfig.hostname}`
  } else if (token) {
    console.log(chalk.yellow("Telegram bot token found but no tunnel configured. Telegram won't work without a tunnel."))
    console.log(chalk.dim("Run `persona setup-telegram` to configure a Cloudflare tunnel."))
  }

  // 4. Generate docker-compose file
  const composePath = generateComposeFile({
    name,
    persona,
    port,
    tunnelConfigDir,
    webhookUrl,
  })

  const projectDir = getProjectDir()
  const projectName = `persona-${name}`
  const composeArgs = ["-p", projectName, "-f", composePath]

  console.log(chalk.dim("Building and starting containers..."))

  // 5. Build and start the stack
  try {
    execSync(
      `docker compose ${composeArgs.join(" ")} up -d --build`,
      { cwd: projectDir, stdio: "inherit" },
    )
  } catch (err) {
    console.error(chalk.red(`Failed to start containers: ${(err as Error).message}`))
    if (tunnelConfigDir) cleanupTunnelConfig(tunnelConfigDir)
    process.exit(1)
  }

  console.log(chalk.green("Containers started."))
  if (webhookUrl) {
    console.log(chalk.green(`Tunnel: ${webhookUrl}`))
    console.log(chalk.dim(`Webhook: ${webhookUrl}/webhook/${name}`))
  }

  // 6. Wait for IPC socket
  const sockPath = socketPath(name)
  console.log(chalk.dim("Waiting for engine to start..."))
  try {
    await waitForSocket(sockPath)
  } catch {
    console.error(chalk.red("Engine failed to start within timeout."))
    console.error(chalk.dim("Check logs: docker compose " + composeArgs.join(" ") + " logs engine"))
    shutdown(composeArgs, projectDir, tunnelConfigDir)
    process.exit(1)
  }

  console.log(chalk.bold(`\n${persona.name} is live.\n`))

  // 7. Cleanup on exit
  let logsProcess: ChildProcess | null = null

  const cleanup = () => {
    console.log(chalk.dim("\nShutting down..."))
    if (logsProcess) {
      logsProcess.kill()
      logsProcess = null
    }
    shutdown(composeArgs, projectDir, tunnelConfigDir)
    console.log(chalk.dim("Done."))
    process.exit(0)
  }

  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)

  // 8. CLI mode or log tailing
  if (options.cli !== false) {
    connectToPersona(name)
  } else {
    console.log(chalk.dim("Running in Telegram-only mode. Press Ctrl+C to stop."))
    logsProcess = spawn(
      "docker",
      ["compose", ...composeArgs, "logs", "-f"],
      { cwd: projectDir, stdio: "inherit" },
    )
    await new Promise(() => {}) // block forever
  }
}

/**
 * Wait for the IPC socket file to appear (engine is ready).
 */
function waitForSocket(sockPath: string, timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (existsSync(sockPath)) {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      unwatchFile(sockPath)
      reject(new Error("Timed out waiting for engine socket"))
    }, timeoutMs)

    // Poll every second since fs.watchFile is more reliable for new files
    const interval = setInterval(() => {
      if (existsSync(sockPath)) {
        clearTimeout(timeout)
        clearInterval(interval)
        unwatchFile(sockPath)
        resolve()
      }
    }, 1000)
  })
}

/**
 * Tear down the docker-compose stack and clean up temp files.
 */
function shutdown(composeArgs: string[], projectDir: string, tunnelConfigDir?: string): void {
  try {
    execSync(`docker compose ${composeArgs.join(" ")} down`, {
      cwd: projectDir,
      stdio: "inherit",
      timeout: 30000,
    })
  } catch {
    // Best effort
  }
  if (tunnelConfigDir) {
    cleanupTunnelConfig(tunnelConfigDir)
  }
}
