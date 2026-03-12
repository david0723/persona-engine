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

export interface McpServerLocal {
  type: "local"
  command: string[]
  environment?: Record<string, string>
}

export interface McpServerRemote {
  type: "remote"
  url: string
  enabled?: boolean
}

export type McpServer = McpServerLocal | McpServerRemote

export interface ContainerConfig {
  enabled: boolean
  image?: string // defaults to "persona-engine:latest"
}

export interface TelegramConfig {
  enabled: boolean
  allowed_chat_ids?: number[]
}

export interface PersonaDefinition {
  name: string
  identity: PersonaIdentity
  backstory: string
  instructions: string
  mcp_servers?: Record<string, McpServer>
  container?: ContainerConfig
  telegram?: TelegramConfig
  heartbeat: HeartbeatConfig
}
