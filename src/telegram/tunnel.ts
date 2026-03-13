import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { TunnelConfig } from "../persona/schema.js"

/**
 * Decode a Cloudflare tunnel token (base64-encoded JSON) into its components.
 */
export function decodeToken(token: string): { accountTag: string; tunnelSecret: string; tunnelId: string } {
  const json = JSON.parse(Buffer.from(token, "base64").toString("utf-8"))
  return {
    accountTag: json.a,
    tunnelSecret: json.s,
    tunnelId: json.t,
  }
}

export interface TunnelConfigFiles {
  dir: string          // temp directory containing the config files
  configPath: string   // path to config.yml
  credentialsPath: string  // path to credentials.json
}

/**
 * Write cloudflared tunnel configuration files to a temp directory.
 *
 * These files are meant to be mounted into a cloudflared container at /etc/cloudflared.
 * The config.yml references credentials and ingress using the containerCredentialsPath.
 *
 * @param token - Cloudflare tunnel token (base64-encoded)
 * @param hostname - Public hostname for the tunnel (e.g., "architect.davidkarolina.com")
 * @param serviceUrl - Backend service URL (e.g., "http://engine:3100" for compose, "http://localhost:3100" for local)
 * @param containerCredentialsPath - Path to credentials.json as seen inside the container (default: /etc/cloudflared/credentials.json)
 */
export function writeTunnelConfig(
  token: string,
  hostname: string,
  serviceUrl: string,
  containerCredentialsPath = "/etc/cloudflared/credentials.json",
): TunnelConfigFiles {
  const { accountTag, tunnelSecret, tunnelId } = decodeToken(token)

  const dir = join(tmpdir(), `persona-tunnel-${tunnelId}`)
  mkdirSync(dir, { recursive: true })

  // Write credentials file
  const credentialsPath = join(dir, "credentials.json")
  writeFileSync(credentialsPath, JSON.stringify({
    AccountTag: accountTag,
    TunnelSecret: tunnelSecret,
    TunnelID: tunnelId,
  }))

  // Write config with ingress rules
  const configPath = join(dir, "config.yml")
  writeFileSync(configPath, [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${containerCredentialsPath}`,
    `protocol: http2`,
    `ingress:`,
    `  - hostname: ${hostname}`,
    `    service: ${serviceUrl}`,
    `  - service: http_status:404`,
  ].join("\n"))

  return { dir, configPath, credentialsPath }
}

/**
 * Clean up tunnel config temp directory.
 */
export function cleanupTunnelConfig(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch { /* best effort */ }
}
