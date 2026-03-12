import { spawn, type ChildProcess } from "node:child_process"

let tunnelProcess: ChildProcess | null = null

export async function startTunnel(port: number): Promise<string> {
  // Try cloudflared first, then localtunnel
  try {
    return await startCloudflared(port)
  } catch {
    console.log("cloudflared not found, trying localtunnel...")
    return startLocaltunnel(port)
  }
}

function startCloudflared(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    tunnelProcess = proc
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error("cloudflared tunnel timed out"))
      }
    }, 30000)

    // cloudflared prints the URL to stderr
    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString()
      const match = text.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/)
      if (match && !resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(match[1])
      }
    })

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(err)
      }
    })

    proc.on("close", (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`cloudflared exited with code ${code}`))
      }
    })
  })
}

function startLocaltunnel(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["-y", "localtunnel", "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    tunnelProcess = proc
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error("localtunnel timed out. Install cloudflared: brew install cloudflared"))
      }
    }, 60000)

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString()
      const match = text.match(/(https:\/\/[^\s]+)/)
      if (match && !resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(match[1])
      }
    })

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(err)
      }
    })
  })
}

export function stopTunnel(): void {
  if (tunnelProcess) {
    tunnelProcess.kill()
    tunnelProcess = null
  }
}
