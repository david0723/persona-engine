import { execSync } from "node:child_process"
import { registerTool } from "./registry.js"

const ALLOWED_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "date", "cal", "whoami",
  "pwd", "echo", "which", "file", "du", "df", "uname", "uptime",
  "ps", "env", "printenv",
])

registerTool({
  name: "shell",
  description: "Run a shell command. Limited to safe, read-only commands for exploring the system.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string",
        description: "The shell command to run",
      },
    },
    required: ["command"],
  },
  async execute(input) {
    const command = String(input.command).trim()
    const baseCommand = command.split(/\s+/)[0]

    if (!ALLOWED_COMMANDS.has(baseCommand)) {
      return `Command "${baseCommand}" is not allowed. Available: ${[...ALLOWED_COMMANDS].join(", ")}`
    }

    try {
      const output = execSync(command, {
        timeout: 5000,
        encoding: "utf-8",
        maxBuffer: 1024 * 50,
      })
      return output.slice(0, 10000)
    } catch (err) {
      const error = err as { stderr?: string; message?: string }
      return `Error: ${error.stderr ?? error.message ?? "Command failed"}`
    }
  },
})
