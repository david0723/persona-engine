import { execFileSync, spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { ensureContainer, execInContainer, execInContainerStreaming } from "./container.js"
import type { PersonaDefinition } from "../persona/schema.js"

const OPENCODE_BIN = join(homedir(), ".opencode", "bin", "opencode")
const OPENCODE_BIN_CONTAINER = "/home/persona/.opencode/bin/opencode"

export interface OpenCodeRunOptions {
  message: string
  persona: PersonaDefinition
  dir?: string
  session?: string
  continueSession?: boolean
  model?: string
  title?: string
}

function buildArgs(options: OpenCodeRunOptions): string[] {
  const args = ["run"]

  if (options.dir) args.push("--dir", options.dir)
  if (options.session) args.push("--session", options.session)
  if (options.continueSession) args.push("--continue")
  if (options.model) args.push("--model", options.model)
  if (options.title) args.push("--title", options.title)

  args.push(options.message)

  return args
}

function useContainer(persona: PersonaDefinition): boolean {
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

export function openCodeRunStreaming(options: OpenCodeRunOptions, onFirstChunk?: () => void): Promise<string> {
  if (useContainer(options.persona)) {
    ensureContainer(options.persona)
    const bin = OPENCODE_BIN_CONTAINER
    const args = buildArgs({ ...options, dir: "/home/persona/data" })
    return execInContainerStreaming(options.persona, [bin, ...args])
  }

  return new Promise((resolve, reject) => {
    const args = buildArgs(options)

    const child = spawn(OPENCODE_BIN, args, {
      cwd: options.dir ?? homedir(),
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    let firstChunkFired = false

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString()
      if (!firstChunkFired) {
        firstChunkFired = true
        onFirstChunk?.()
      }
      output += text
      process.stdout.write(text)
    })

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString()
      if (!text.includes("MetadataLookup") && !text.includes("warn")) {
        process.stderr.write(data)
      }
    })

    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve(output)
      } else {
        reject(new Error(`opencode exited with code ${code}`))
      }
    })

    child.on("error", reject)
  })
}
