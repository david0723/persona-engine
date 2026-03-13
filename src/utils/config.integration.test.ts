import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { loadPersonaEnv } from "./config.js"
import { useTempPersonaHome } from "../test-helpers/temp-dir.js"

let tempHome: ReturnType<typeof useTempPersonaHome>

beforeEach(() => {
  tempHome = useTempPersonaHome()
})

afterEach(() => {
  tempHome.cleanup()
})

function writeEnvFile(name: string, content: string): void {
  const dir = tempHome.personaDir(name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, ".env"), content)
}

describe("loadPersonaEnv", () => {
  it("reads KEY=VALUE pairs from .env file", () => {
    writeEnvFile("alice", "API_KEY=sk-123\nMODEL=gpt-4")
    const env = loadPersonaEnv("alice")
    expect(env.API_KEY).toBe("sk-123")
    expect(env.MODEL).toBe("gpt-4")
  })

  it("strips double-quoted values", () => {
    writeEnvFile("alice", 'SECRET="my-secret-value"')
    const env = loadPersonaEnv("alice")
    expect(env.SECRET).toBe("my-secret-value")
  })

  it("strips single-quoted values", () => {
    writeEnvFile("alice", "SECRET='my-secret-value'")
    const env = loadPersonaEnv("alice")
    expect(env.SECRET).toBe("my-secret-value")
  })

  it("handles values containing = signs", () => {
    writeEnvFile("alice", "CONNECTION=postgres://user:pass@host/db?opt=val")
    const env = loadPersonaEnv("alice")
    expect(env.CONNECTION).toBe("postgres://user:pass@host/db?opt=val")
  })

  it("skips comments and blank lines", () => {
    writeEnvFile("alice", "# This is a comment\n\nKEY=value\n\n# Another comment")
    const env = loadPersonaEnv("alice")
    expect(Object.keys(env)).toEqual(["KEY"])
    expect(env.KEY).toBe("value")
  })

  it("returns empty object when file missing", () => {
    // Create persona dir without .env
    mkdirSync(tempHome.personaDir("alice"), { recursive: true })
    const env = loadPersonaEnv("alice")
    expect(env).toEqual({})
  })
})
