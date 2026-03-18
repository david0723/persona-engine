import { execFileSync, spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { isContainerized, ensureContainer, execInContainer, execInContainerStreaming } from "./container.js"
import type { PersonaDefinition } from "../persona/schema.js"

const OPENCODE_BIN = join(homedir(), ".opencode", "bin", "opencode")
const OPENCODE_BIN_CONTAINER = "/home/persona/.opencode/bin/opencode"

/** Inactivity threshold before emitting a warning (ms). */
const INACTIVITY_WARN_MS = 2 * 60 * 1000
/** Inactivity threshold before killing the process (ms). */
const INACTIVITY_KILL_MS = 5 * 60 * 1000
/** Hard cap regardless of activity (ms). */
const HARD_TIMEOUT_MS = 30 * 60 * 1000

export interface OpenCodeRunOptions {
  message: string
  persona: PersonaDefinition
  dir?: string
  session?: string
  continueSession?: boolean
  model?: string
  title?: string
  attachUrl?: string  // URL of running opencode server to attach to
  agent?: string      // OpenCode agent name to use (e.g. "brain-dump-processor")
}

function buildArgs(options: OpenCodeRunOptions): string[] {
  const args = ["run"]

  if (options.dir) args.push("--dir", options.dir)
  if (options.session) args.push("--session", options.session)
  if (options.continueSession) args.push("--continue")
  if (options.model) args.push("--model", options.model)
  if (options.title) args.push("--title", options.title)
  if (options.attachUrl) args.push("--attach", options.attachUrl)
  if (options.agent) args.push("--agent", options.agent)

  args.push(options.message)

  return args
}

function useContainer(persona: PersonaDefinition): boolean {
  if (isContainerized()) return false
  return persona.container?.enabled === true
}

export function openCodeRun(options: OpenCodeRunOptions): string {
  if (useContainer(options.persona)) {
    ensureContainer(options.persona)
    const bin = OPENCODE_BIN_CONTAINER
    const args = buildArgs({ ...options, dir: "/home/persona/data" })
    return execInContainer(options.persona, [bin, ...args])
  }

  const args = buildArgs(options)

  return execFileSync(OPENCODE_BIN, args, {
    encoding: "utf-8",
    timeout: 300000,
    maxBuffer: 1024 * 1024 * 10,
    cwd: options.dir ?? homedir(),
    stdio: ["pipe", "pipe", "pipe"],
  })
}

export async function openCodeRunAsync(options: OpenCodeRunOptions): Promise<string> {
  return openCodeRunStreaming(options, undefined, () => {}, () => {})
}

export function openCodeRunStreaming(
  options: OpenCodeRunOptions,
  onFirstChunk?: () => void,
  onChunk?: (text: string) => void,
  onStderr?: (text: string) => void,
): Promise<string> {
  if (useContainer(options.persona)) {
    ensureContainer(options.persona)
    const bin = OPENCODE_BIN_CONTAINER
    const args = buildArgs({ ...options, dir: "/home/persona/data" })
    return execInContainerStreaming(options.persona, [bin, ...args], onFirstChunk, onChunk, onStderr)
  }

  return new Promise((resolve, reject) => {
    const args = buildArgs(options)

    const child = spawn(OPENCODE_BIN, args, {
      cwd: options.dir ?? homedir(),
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    let stderrOutput = ""
    let firstChunkFired = false
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(hardTimer)
      clearTimeout(inactivityTimer)
      fn()
    }

    // Inactivity timer: resets on every data event
    let warnFired = false
    let inactivityTimer = setTimeout(() => onInactive(), INACTIVITY_WARN_MS)

    const resetInactivity = () => {
      warnFired = false
      clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => onInactive(), INACTIVITY_WARN_MS)
    }

    function onInactive(): void {
      if (settled) return
      if (!warnFired) {
        warnFired = true
        onStderr?.("No output for 2 minutes, process may be stuck")
        inactivityTimer = setTimeout(() => onInactive(), INACTIVITY_KILL_MS - INACTIVITY_WARN_MS)
        return
      }
      // Kill after full inactivity period
      child.kill("SIGKILL")
      settle(() => reject(new Error("opencode killed after 5 minutes of inactivity")))
    }

    // Hard timeout: kill no matter what
    const hardTimer = setTimeout(() => {
      if (settled) return
      child.kill("SIGKILL")
      settle(() => reject(new Error("opencode killed after 30 minute hard timeout")))
    }, HARD_TIMEOUT_MS)

    child.stdout.on("data", (data: Buffer) => {
      resetInactivity()
      const text = data.toString()
      if (!firstChunkFired) {
        firstChunkFired = true
        onFirstChunk?.()
      }
      output += text
      if (onChunk) {
        onChunk(text)
      } else {
        process.stdout.write(text)
      }
    })

    child.stderr.on("data", (data: Buffer) => {
      resetInactivity()
      const text = data.toString()
      stderrOutput += text
      // Forward meaningful stderr via callback
      if (onStderr) {
        const trimmed = text.trim()
        if (trimmed && !trimmed.includes("MetadataLookup") && !trimmed.includes("warn")) {
          onStderr(trimmed)
        }
        return
      }
      if (!text.includes("MetadataLookup") && !text.includes("warn")) {
        process.stderr.write(data)
      }
    })

    child.on("close", (code) => {
      settle(() => {
        if (code === 0 || code === null) {
          resolve(output)
        } else {
          reject(new Error(`opencode exited with code ${code}: ${stderrOutput.trim()}`))
        }
      })
    })

    child.on("error", (err) => settle(() => reject(err)))
  })
}
