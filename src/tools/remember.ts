import { Type } from "@google/genai"
import { registerTool } from "./registry.js"
import type { MemoryKind } from "../memory/types.js"

registerTool({
  name: "remember",
  description: "Store an important memory that you want to keep long-term. Use 'core_memory' for things about yourself (realizations, preferences, opinions). Use 'relationship_note' for things about people you interact with.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      content: {
        type: Type.STRING,
        description: "What you want to remember",
      },
      kind: {
        type: Type.STRING,
        description: "Type of memory: core_memory (about yourself) or relationship_note (about someone else)",
      },
      importance: {
        type: Type.NUMBER,
        description: "How important this is (1-10, default 7)",
      },
    },
    required: ["content", "kind"],
  },
  async execute(input, context) {
    const kind = input.kind as MemoryKind
    const importance = typeof input.importance === "number" ? input.importance : 7

    context.store.addMemory(kind, String(input.content), importance, context.sessionId)
    return `Memory stored (${kind}, importance: ${importance}).`
  },
})
