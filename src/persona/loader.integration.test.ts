import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { stringify } from "yaml"
import { loadPersona } from "./loader.js"
import { useTempPersonaHome } from "../test-helpers/temp-dir.js"
import { makePersona } from "../test-helpers/fixtures.js"

let tempHome: ReturnType<typeof useTempPersonaHome>

beforeEach(() => {
  tempHome = useTempPersonaHome()
})

afterEach(() => {
  tempHome.cleanup()
})

function writePersonaYaml(name: string, data: Record<string, unknown>): void {
  const dir = tempHome.personaDir(name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "persona.yaml"), stringify(data))
}

describe("persona YAML round-trip", () => {
  it("writes YAML to temp dir, loads back with all fields preserved", () => {
    const original = makePersona({ name: "alice" })
    writePersonaYaml("alice", original as unknown as Record<string, unknown>)

    const loaded = loadPersona("alice")
    expect(loaded.name).toBe("alice")
    expect(loaded.identity!.role).toBe(original.identity!.role)
    expect(loaded.identity!.speaking_style).toBe(original.identity!.speaking_style)
    expect(loaded.identity!.values).toEqual(original.identity!.values)
    expect(loaded.backstory).toBe(original.backstory)
    expect(loaded.instructions).toBe(original.instructions)
    expect(loaded.heartbeat.enabled).toBe(original.heartbeat.enabled)
    expect(loaded.heartbeat.interval_minutes).toBe(original.heartbeat.interval_minutes)
    expect(loaded.heartbeat.activities).toEqual(original.heartbeat.activities)
  })

  it("missing persona.yaml throws descriptive error", () => {
    expect(() => loadPersona("nonexistent")).toThrow(/not found/)
  })

  it("invalid YAML syntax throws parse error", () => {
    const dir = tempHome.personaDir("bad")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "persona.yaml"), ": invalid: yaml: [unclosed")

    expect(() => loadPersona("bad")).toThrow()
  })
})
