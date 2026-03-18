export interface PersonaIdentity {
  role: string
  speaking_style: string
  values: string[]
}

export type NotifyMode = "telegram" | "silent" | "vault-only"

export interface HeartbeatConfig {
  enabled: boolean
  interval_minutes: number
  activities: string[]
  prompt?: string  // Custom heartbeat prompt framing. Replaces default reflection framing.
  notify?: boolean | NotifyMode // Send heartbeat results to Telegram. Default: false.
  // When notify is a NotifyMode string: "telegram" sends to Telegram,
  // "silent" runs but doesn't notify, "vault-only" writes to vault only.
  // Boolean true = "telegram", false = "silent".
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
  network?: "none" | "bridge" | "host" // default: "none" (no internet)
  memory_limit?: string // e.g. "512m"
  cpu_limit?: string // e.g. "1.0"
  allowed_env?: string[] // env var names to pass through from host
  docker_socket?: boolean // mount host Docker socket for DooD orchestration
}

export interface TunnelConfig {
  hostname: string  // stable subdomain (e.g. "architect.davidkarolina.com")
}

export interface TelegramConfig {
  enabled: boolean
  bot_token: string
  allowed_chat_ids?: number[]
  tunnel?: TunnelConfig
}

export interface SelfUpdateConfig {
  enabled: boolean
  repo_url?: string
  branch?: string // default: "main"
}

export interface VaultConfig {
  enabled: boolean
  path?: string        // container path, default: "/home/persona/vault"
  host_path?: string   // host path for volume mount
}

export interface PermissionConfig {
  bash?: "allow" | "ask" | "deny"
  edit?: "allow" | "ask" | "deny"
  read?: "allow" | "ask" | "deny"
  external_directory?: "allow" | "ask" | "deny"
}

export interface PersonaFeatures {
  identity: boolean
  memory: boolean
  journal: boolean
  conversation_summary: boolean
}

export interface PersonaDefinition {
  name: string
  model?: string
  features?: Partial<PersonaFeatures>
  identity?: PersonaIdentity
  backstory?: string
  instructions?: string
  mcp_servers?: Record<string, McpServer>
  container?: ContainerConfig
  vault?: VaultConfig
  telegram?: TelegramConfig
  heartbeat: HeartbeatConfig
  permissions?: PermissionConfig
  self_update?: SelfUpdateConfig
}
