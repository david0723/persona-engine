import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { registerTool } from "./registry.js"

registerTool({
  name: "read-file",
  description: "Read the contents of a file from disk. Restricted to your home directory.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Path to the file (absolute or relative to home)",
      },
    },
    required: ["path"],
  },
  async execute(input) {
    const home = homedir()
    const filePath = resolve(home, String(input.path))

    if (!filePath.startsWith(home)) {
      return "Access denied: can only read files within home directory."
    }

    if (!existsSync(filePath)) {
      return `File not found: ${filePath}`
    }

    try {
      const content = readFileSync(filePath, "utf-8")
      if (content.length > 10000) {
        return content.slice(0, 10000) + "\n... (truncated)"
      }
      return content
    } catch (err) {
      return `Error reading file: ${(err as Error).message}`
    }
  },
})
