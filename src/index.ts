#!/usr/bin/env node

import { Command } from "commander"
import { createPersona } from "./commands/create.js"
import { listPersonas } from "./commands/list.js"
import { chatWithPersona } from "./commands/chat.js"
import { heartbeatCommand } from "./commands/heartbeat.js"
import { inspectMemory } from "./commands/memory.js"
import { installHeartbeat } from "./commands/install-heartbeat.js"
import { servePersona } from "./commands/serve.js"
import { deployPersona } from "./commands/deploy.js"
import { attachToPersona } from "./commands/attach.js"
import { setupTelegram } from "./commands/setup-telegram.js"

const program = new Command()
  .name("persona")
  .description("Virtual Persona Engine - autonomous AI characters that live on your machine")
  .version("0.1.0")

program
  .command("create <name>")
  .description("Create a new persona")
  .option("-t, --template <template>", "Template to use (default, architect)")
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

program
  .command("attach <name>")
  .description("Attach to a running persona's session")
  .action(attachToPersona)

program
  .command("deploy <name>")
  .description("Build and deploy persona as a Docker container")
  .option("--webhook-url <url>", "External webhook URL for Telegram")
  .option("-p, --port <port>", "Container port", "3100")
  .option("--with-supervisor", "Show systemd supervisor setup instructions")
  .action(deployPersona)

program
  .command("setup-telegram <name>")
  .description("Provision a Cloudflare tunnel and configure Telegram for a persona")
  .option("-d, --domain <domain>", "Base domain for tunnel hostname", "davidkarolina.com")
  .action(setupTelegram)

program.parse()
