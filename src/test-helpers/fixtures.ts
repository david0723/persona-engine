import type { PersonaDefinition } from "../persona/schema.js"

export function makePersona(overrides?: Partial<PersonaDefinition>): PersonaDefinition {
  return {
    name: "test-persona",
    identity: {
      role: "A helpful test assistant.",
      speaking_style: "Clear and concise.",
      values: ["testing", "reliability"],
    },
    backstory: "You were created for integration testing.",
    instructions: "Answer all questions honestly.",
    heartbeat: {
      enabled: false,
      interval_minutes: 60,
      activities: [],
    },
    ...overrides,
  }
}

export function makePersonaWithTelegram(): PersonaDefinition {
  return makePersona({
    telegram: {
      enabled: true,
      bot_token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      allowed_chat_ids: [12345],
      tunnel: { hostname: "test.example.com" },
    },
  })
}

export function makePersonaWithContainer(): PersonaDefinition {
  return makePersona({
    container: {
      enabled: true,
      network: "bridge",
      memory_limit: "256M",
      cpu_limit: "0.5",
    },
  })
}

export function makePersonaWithDockerSocket(): PersonaDefinition {
  return makePersona({
    container: {
      enabled: true,
      network: "bridge",
      memory_limit: "1g",
      cpu_limit: "1.5",
      docker_socket: true,
    },
  })
}
