#!/usr/bin/env node

import { config } from "dotenv"
import { paths } from "./utils/config.js"
import { join } from "node:path"

// Load .env from ~/.persona-engine/ so it works from any directory
config({ path: join(paths.home, ".env") })

import { Command } from "commander"
import { createPersona } from "./commands/create.js"
import { listPersonas } from "./commands/list.js"
import { chatWithPersona } from "./commands/chat.js"
import { heartbeatCommand } from "./commands/heartbeat.js"
import { inspectMemory } from "./commands/memory.js"
import { installHeartbeat } from "./commands/install-heartbeat.js"
import { servePersona } from "./commands/serve.js"

const program = new Command()
  .name("persona")
  .description("Virtual Persona Engine - autonomous AI characters that live on your machine")
  .version("0.1.0")

program
  .command("create <name>")
  .description("Create a new persona")
  .action(createPersona)

program
  .command("list")
  .description("List all personas")
  .action(listPersonas)

program
  .command("chat <name>")
  .description("Chat with a persona")
  .action(chatWithPersona)

program
  .command("heartbeat <name>")
  .description("Run one heartbeat cycle for a persona")
  .action(heartbeatCommand)

program
  .command("memory <name>")
  .description("Inspect persona memories")
  .option("-k, --kind <type>", "Filter by memory kind")
  .option("-r, --recent <n>", "Show last N entries")
  .action(inspectMemory)

program
  .command("install-heartbeat <name>")
  .description("Install launchd schedule for heartbeat")
  .option("-u, --uninstall", "Remove the heartbeat schedule")
  .action(installHeartbeat)

program
  .command("serve <name>")
  .description("Start persona with CLI + Telegram (requires TELEGRAM_BOT_TOKEN)")
  .option("-p, --port <port>", "Webhook server port", "3100")
  .option("--no-cli", "Telegram only, no CLI input")
  .action(servePersona)

program.parse()
