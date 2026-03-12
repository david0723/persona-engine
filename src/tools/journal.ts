import { registerTool } from "./registry.js"

registerTool({
  name: "journal",
  description: "Write a journal entry to record your thoughts, reflections, or observations. Use this to build your inner life and remember important realizations.",
  input_schema: {
    type: "object" as const,
    properties: {
      entry: {
        type: "string",
        description: "The journal entry content",
      },
      topic: {
        type: "string",
        description: "Optional topic or theme for this entry",
      },
    },
    required: ["entry"],
  },
  async execute(input, context) {
    const entry = input.topic
      ? `[${input.topic}] ${input.entry}`
      : String(input.entry)

    context.store.addMemory("journal_entry", entry, 6, context.sessionId)
    return `Journal entry recorded.`
  },
})
