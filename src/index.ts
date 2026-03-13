#!/usr/bin/env node

import { Command } from "commander"
import { createPersona } from "./commands/create.js"
import { listPersonas } from "./commands/list.js"
import { heartbeatCommand } from "./commands/heartbeat.js"
import { inspectMemory } from "./commands/memory.js"
import { installHeartbeat } from "./commands/install-heartbeat.js"
import { startPersona } from "./commands/start.js"
import { attachToPersona } from "./commands/attach.js"
import { renamePersona } from "./commands/rename.js"
import { showHistory } from "./commands/history.js"

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
  .command("start <name>")
  .description("Start a persona (syncs infrastructure from YAML)")
  .option("-p, --port <port>", "Webhook server port", "3100")
  .option("--no-cli", "No CLI input (headless/Telegram only)")
  .option("-d, --detached", "Run in background, don't attach CLI")
  .option("-v, --verbose", "Show all engine logs including stderr")
  .action(startPersona)

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
  .command("history <name>")
  .description("Show recent activity timeline for a persona")
  .option("-s, --sessions <n>", "Number of sessions to show", "5")
  .option("-v, --verbose", "Show full content")
  .action(showHistory)

program
  .command("install-heartbeat <name>")
  .description("Install launchd schedule for heartbeat")
  .option("-u, --uninstall", "Remove the heartbeat schedule")
  .action(installHeartbeat)

program
  .command("attach <name>")
  .description("Attach to a running persona's session")
  .action(attachToPersona)

program
  .command("rename <old> <new>")
  .description("Rename a persona (data dir, config, and infrastructure)")
  .action(renamePersona)

// Hidden backward-compat aliases
program
  .command("serve <name>", { hidden: true })
  .option("-p, --port <port>", "Webhook server port", "3100")
  .option("--no-cli", "No CLI input")
  .action(startPersona)

program
  .command("chat <name>", { hidden: true })
  .action((name: string) => startPersona(name, {}))

program.parseAsync().catch((err) => {
  console.error((err as Error).message)
  process.exit(1)
})
