import React from "react"
import { render } from "ink"
import { ChatApp } from "../ui/ChatApp.js"
import { ConversationEngine } from "./engine.js"
import type { PersonaDefinition } from "../persona/schema.js"

export async function startChat(persona: PersonaDefinition): Promise<void> {
  const engine = new ConversationEngine(persona)
  return runCliAdapter(engine)
}

export async function runCliAdapter(engine: ConversationEngine): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(ChatApp, { engine, persona: engine.persona })
  )

  await waitUntilExit()
}
