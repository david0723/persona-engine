import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { writeOpenCodeConfig } from "./opencode-config.js"
import { useTempPersonaHome } from "../test-helpers/temp-dir.js"
import { makePersona } from "../test-helpers/fixtures.js"

let tempHome: ReturnType<typeof useTempPersonaHome>

beforeEach(() => {
  tempHome = useTempPersonaHome()
})

afterEach(() => {
  tempHome.cleanup()
})

describe("writeOpenCodeConfig", () => {
  it("writes valid JSON to persona dir", () => {
    const persona = makePersona({ name: "alice" })
    const configPath = writeOpenCodeConfig(persona)
    const raw = readFileSync(configPath, "utf-8")
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(configPath).toBe(join(tempHome.personaDir("alice"), "opencode.json"))
  })

  it("includes mcp_servers from persona config", () => {
    const persona = makePersona({
      name: "alice",
      mcp_servers: {
        "my-server": { type: "remote", url: "https://mcp.example.com" },
      },
    })
    const configPath = writeOpenCodeConfig(persona)
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(config.mcp).toBeDefined()
    expect(config.mcp["my-server"].url).toBe("https://mcp.example.com")
  })

  it("sets permissions when containerized", () => {
    const persona = makePersona({
      name: "alice",
      container: { enabled: true, network: "bridge" },
    })
    const configPath = writeOpenCodeConfig(persona)
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(config.permission).toEqual({ bash: "allow", edit: "allow", read: "allow", external_directory: "allow" })
  })

  it("adds external_directory when containerized with explicit permissions", () => {
    const persona = makePersona({
      name: "alice",
      container: { enabled: true, network: "bridge" },
      permissions: { bash: "allow", edit: "allow", read: "allow" },
    })
    const configPath = writeOpenCodeConfig(persona)
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(config.permission.external_directory).toBe("allow")
  })

  it("preserves explicit external_directory setting in container", () => {
    const persona = makePersona({
      name: "alice",
      container: { enabled: true, network: "bridge" },
      permissions: { bash: "allow", edit: "allow", read: "allow", external_directory: "deny" },
    })
    const configPath = writeOpenCodeConfig(persona)
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(config.permission.external_directory).toBe("deny")
  })
})
