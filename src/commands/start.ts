import { execSync, spawn, type ChildProcess } from "node:child_process"
import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"
import { isContainerized, isDockerAvailable } from "../runtime/container.js"
import { generateComposeFile, getProjectDir, getIpcHostPort } from "../runtime/compose-generator.js"
import { cleanupTunnelConfig } from "../telegram/tunnel.js"
import { connectToPersona } from "../runtime/ipc-client.js"
import { reconcileTelegram } from "../infra/reconciler.js"

interface StartOptions {
  port?: string
  cli?: boolean      // --no-cli sets to false
  detached?: boolean  // -d flag
  verbose?: boolean   // -v flag
}

export async function startPersona(name: string, options: StartOptions): Promise<void> {
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

  // 2. Reconcile Telegram infrastructure from YAML
  let tunnelConfigDir: string | undefined
  let webhookUrl: string | undefined

  const hasTelegramConfig = persona.telegram?.bot_token && persona.telegram?.tunnel?.hostname

  if (persona.container?.enabled) {
    // Container mode: reconcile tunnel infrastructure
    try {
      const result = await reconcileTelegram(name, persona, port)
      tunnelConfigDir = result.tunnelConfigDir
      webhookUrl = result.webhookUrl
    } catch (err) {
      console.error(chalk.red(`Infrastructure reconciliation failed: ${(err as Error).message}`))
      process.exit(1)
    }
  } else if (hasTelegramConfig) {
    console.log(chalk.yellow("Telegram requires container mode for webhook reachability."))
    console.log(chalk.dim("Set container.enabled: true in persona.yaml to use Telegram."))
  }

  // 3. Choose runtime mode
  if (persona.container?.enabled) {
    await startContainerMode(name, persona, port, options, tunnelConfigDir, webhookUrl)
  } else {
    await startLocalMode(name, persona)
  }
}

async function startContainerMode(
  name: string,
  persona: ReturnType<typeof loadPersona>,
  port: number,
  options: StartOptions,
  tunnelConfigDir?: string,
  webhookUrl?: string,
): Promise<void> {
  if (!isDockerAvailable()) {
    console.error(chalk.red("Docker is not running. Start Docker Desktop or install Docker."))
    process.exit(1)
  }

  // Generate docker-compose file
  const composePath = generateComposeFile({
    name,
    persona,
    port,
    tunnelConfigDir,
    webhookUrl,
    detached: options.detached,
  })

  const projectDir = getProjectDir()
  const projectName = `persona-${name}`
  const composeArgs = ["-p", projectName, "-f", composePath]

  console.log(chalk.dim("Building and starting containers..."))

  // Build and start the stack
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

  // Detached mode: print status and exit
  if (options.detached) {
    console.log(chalk.green(`\n${persona.name} deployed successfully.`))
    console.log(chalk.dim(`Stop with: docker compose ${composeArgs.join(" ")} down`))
    if (tunnelConfigDir) {
      console.log(chalk.dim(`Tunnel config: ${tunnelConfigDir} (do not delete while running)`))
    }
    return
  }

  console.log(chalk.bold(`\n${persona.name} is live.\n`))

  // Cleanup on exit
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

  // CLI mode or log tailing
  if (options.cli !== false) {
    const ipcPort = getIpcHostPort(name)
    connectToPersona(name, { tcpPort: ipcPort, retryMs: 1000, timeoutMs: 60_000, verbose: options.verbose })
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

async function startLocalMode(
  name: string,
  persona: ReturnType<typeof loadPersona>,
): Promise<void> {
  const { startChat } = await import("../runtime/conversation.js")
  await startChat(persona)
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
