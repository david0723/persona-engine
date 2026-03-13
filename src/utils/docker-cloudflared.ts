import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const CLOUDFLARED_IMAGE = "cloudflare/cloudflared:latest"
const HOST_CLOUDFLARED_DIR = join(homedir(), ".cloudflared")
// The cloudflared Docker image runs as user 65532 (nonroot), home at /home/nonroot
const CONTAINER_CLOUDFLARED_DIR = "/home/nonroot/.cloudflared"

/**
 * Run a cloudflared command via Docker instead of requiring the host binary.
 * Mounts ~/.cloudflared for credential persistence.
 */
export function cloudflaredRun(args: string[], options?: { interactive?: boolean }): string {
  const flags = options?.interactive ? "-it" : ""
  const cmd = [
    "docker", "run", "--rm",
    ...(flags ? [flags] : []),
    "-v", `${HOST_CLOUDFLARED_DIR}:${CONTAINER_CLOUDFLARED_DIR}`,
    CLOUDFLARED_IMAGE,
    ...args,
  ].join(" ")

  return execSync(cmd, {
    encoding: "utf-8",
    stdio: options?.interactive ? "inherit" : "pipe",
    timeout: 60000,
  }) as string
}

/**
 * Ensure cloudflared is authenticated by checking for cert.pem.
 * If missing, runs interactive login via Docker.
 */
export function ensureCloudflaredAuth(): void {
  const certPath = join(HOST_CLOUDFLARED_DIR, "cert.pem")
  if (existsSync(certPath)) return

  console.log("cloudflared is not authenticated. Opening browser for login...")
  cloudflaredRun(["tunnel", "login"], { interactive: true })

  if (!existsSync(certPath)) {
    throw new Error("cloudflared login failed. cert.pem not found after login attempt.")
  }
}
