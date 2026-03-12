import { writeFileSync, unlinkSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"
import { homedir } from "node:os"
import chalk from "chalk"
import { loadPersona } from "../persona/loader.js"

const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents")

function plistPath(name: string): string {
  return join(LAUNCH_AGENTS_DIR, `com.persona-engine.${name}.plist`)
}

function buildPlist(name: string, intervalSeconds: number): string {
  const nodePath = process.execPath
  const scriptPath = join(process.cwd(), "dist", "index.js")
  const home = homedir()

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.persona-engine.${name}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>heartbeat</string>
    <string>${name}</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${home}/.persona-engine/personas/${name}/heartbeat.log</string>
  <key>StandardErrorPath</key>
  <string>${home}/.persona-engine/personas/${name}/heartbeat-error.log</string>
  <key>WorkingDirectory</key>
  <string>${home}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:${join(home, ".nvm/versions/node/v20.19.0/bin")}</string>
    <key>HOME</key>
    <string>${home}</string>
  </dict>
</dict>
</plist>`
}

interface InstallOptions {
  uninstall?: boolean
}

export async function installHeartbeat(name: string, options: InstallOptions): Promise<void> {
  const plist = plistPath(name)

  if (options.uninstall) {
    if (!existsSync(plist)) {
      console.log(chalk.yellow(`No heartbeat schedule found for "${name}".`))
      return
    }

    try {
      execSync(`launchctl unload "${plist}"`, { stdio: "pipe" })
    } catch {
      // May already be unloaded
    }
    unlinkSync(plist)
    console.log(chalk.green(`Heartbeat uninstalled for "${name}".`))
    return
  }

  const persona = loadPersona(name)
  const intervalSeconds = persona.heartbeat.interval_minutes * 60

  const content = buildPlist(name, intervalSeconds)
  writeFileSync(plist, content, "utf-8")

  try {
    execSync(`launchctl unload "${plist}" 2>/dev/null; launchctl load "${plist}"`, { stdio: "pipe" })
    console.log(chalk.green(`Heartbeat installed for "${name}" (every ${persona.heartbeat.interval_minutes} minutes).`))
    console.log(chalk.dim(`Plist: ${plist}`))
  } catch (err) {
    console.error(chalk.red(`Failed to load launchd plist: ${(err as Error).message}`))
    process.exit(1)
  }
}
