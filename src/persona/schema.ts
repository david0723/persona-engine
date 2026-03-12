export interface PersonaIdentity {
  role: string
  speaking_style: string
  values: string[]
}

export interface HeartbeatConfig {
  enabled: boolean
  interval_minutes: number
  activities: string[]
}

export interface PersonaDefinition {
  name: string
  identity: PersonaIdentity
  backstory: string
  instructions: string
  tools: string[]
  heartbeat: HeartbeatConfig
}
