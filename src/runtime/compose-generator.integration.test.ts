import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { parse } from "yaml"
import { generateComposeFile, getProjectDir } from "./compose-generator.js"
import { useTempPersonaHome } from "../test-helpers/temp-dir.js"
import { makePersona, makePersonaWithContainer, makePersonaWithDockerSocket } from "../test-helpers/fixtures.js"
import { IPC_TCP_PORT } from "./ipc-server.js"

let tempHome: ReturnType<typeof useTempPersonaHome>

beforeEach(() => {
  tempHome = useTempPersonaHome()
})

afterEach(() => {
  tempHome.cleanup()
})

function setupPersonaDir(name: string, envContent?: string) {
  const dir = tempHome.personaDir(name)
  mkdirSync(dir, { recursive: true })
  if (envContent) {
    writeFileSync(join(dir, ".env"), envContent)
  }
}

function generateAndParse(opts: Parameters<typeof generateComposeFile>[0]) {
  const composePath = generateComposeFile(opts)
  const raw = readFileSync(composePath, "utf-8")
  return parse(raw) as Record<string, unknown>
}

describe("generateComposeFile", () => {
  describe("build context", () => {
    it("build field is absolute path to project root, not relative", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      expect(isAbsolute(engine.build as string)).toBe(true)
      expect(engine.build).toBe(getProjectDir())
    })

    it("project dir contains a Dockerfile", () => {
      expect(existsSync(join(getProjectDir(), "Dockerfile"))).toBe(true)
    })
  })

  describe("YAML structure", () => {
    it("output is valid parseable YAML", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const composePath = generateComposeFile({ name: "alice", persona, port: 3100 })
      const raw = readFileSync(composePath, "utf-8")
      expect(() => parse(raw)).not.toThrow()
    })

    it("engine service has correct command with persona name and port", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      expect(engine.command).toEqual(["start", "alice", "--no-cli", "--port", "3100"])
    })

    it("engine ports map IPC_TCP_PORT", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      expect(engine.ports).toContain(`0:${IPC_TCP_PORT}`)
    })

    it("engine volume bind-mounts persona dir with absolute host path", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      const volumes = engine.volumes as string[]
      const bindMount = volumes.find((v) => v.includes("personas/alice"))
      expect(bindMount).toBeDefined()
      const hostPath = bindMount!.split(":")[0]
      expect(isAbsolute(hostPath)).toBe(true)
    })

    it("network is persona-{name} with bridge driver", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const networks = compose.networks as Record<string, Record<string, unknown>>
      expect(networks["persona-alice"]).toBeDefined()
      expect(networks["persona-alice"].driver).toBe("bridge")
    })
  })

  describe("environment variables", () => {
    it("includes PERSONA_ENGINE_CONTAINERIZED=true", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      expect(engine.environment).toContain("PERSONA_ENGINE_CONTAINERIZED=true")
    })

    it("includes all vars from persona .env file", () => {
      setupPersonaDir("alice", "API_KEY=sk-123\nMODEL=gpt-4")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      const env = engine.environment as string[]
      expect(env).toContain("API_KEY=sk-123")
      expect(env).toContain("MODEL=gpt-4")
    })

    it("includes WEBHOOK_URL when provided", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({
        name: "alice", persona, port: 3100,
        webhookUrl: "https://example.com/webhook",
      })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      expect(engine.environment).toContain("WEBHOOK_URL=https://example.com/webhook")
    })

    it("includes PERSONA_ENGINE_REPO_URL from self_update", () => {
      setupPersonaDir("alice")
      const persona = makePersona({
        name: "alice",
        self_update: { enabled: true, repo_url: "https://github.com/test/repo" },
      })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      const env = engine.environment as string[]
      expect(env).toContain("PERSONA_ENGINE_REPO_URL=https://github.com/test/repo")
    })

    it("handles special characters in env values", () => {
      setupPersonaDir("alice", 'SECRET="p@ss=w0rd!#$"')
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      const env = engine.environment as string[]
      expect(env).toContain("SECRET=p@ss=w0rd!#$")
    })
  })

  describe("tunnel service", () => {
    it("adds tunnel service when tunnelConfigDir provided", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({
        name: "alice", persona, port: 3100,
        tunnelConfigDir: "/tmp/tunnel-config",
      })
      const services = compose.services as Record<string, Record<string, unknown>>
      expect(services.tunnel).toBeDefined()
    })

    it("tunnel mounts config dir as /etc/cloudflared:ro", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({
        name: "alice", persona, port: 3100,
        tunnelConfigDir: "/tmp/tunnel-config",
      })
      const tunnel = (compose.services as Record<string, Record<string, unknown>>).tunnel
      expect(tunnel.volumes).toContain("/tmp/tunnel-config:/etc/cloudflared:ro")
    })

    it("tunnel depends_on engine", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({
        name: "alice", persona, port: 3100,
        tunnelConfigDir: "/tmp/tunnel-config",
      })
      const tunnel = (compose.services as Record<string, Record<string, unknown>>).tunnel
      expect(tunnel.depends_on).toContain("engine")
    })

    it("no tunnel service when tunnelConfigDir undefined", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const services = compose.services as Record<string, Record<string, unknown>>
      expect(services.tunnel).toBeUndefined()
    })
  })

  describe("optional features", () => {
    it("adds named workspace volume when self_update enabled", () => {
      setupPersonaDir("alice")
      const persona = makePersona({
        name: "alice",
        self_update: { enabled: true, repo_url: "https://github.com/test/repo" },
      })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      expect(compose.volumes).toBeDefined()
      const volumes = compose.volumes as Record<string, unknown>
      expect(volumes["persona-workspace-alice"]).toBeDefined()
    })

    it("adds healthcheck when webhookUrl provided", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({
        name: "alice", persona, port: 3100,
        webhookUrl: "https://example.com/webhook",
      })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      expect(engine.healthcheck).toBeDefined()
    })

    it("mounts Docker socket when docker_socket is true", () => {
      setupPersonaDir("alice")
      const persona = makePersonaWithDockerSocket()
      persona.name = "alice"
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      const volumes = engine.volumes as string[]
      expect(volumes).toContain("/var/run/docker.sock:/var/run/docker.sock")
    })

    it("does not mount Docker socket by default", () => {
      setupPersonaDir("alice")
      const persona = makePersona({ name: "alice" })
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      const volumes = engine.volumes as string[]
      expect(volumes.some((v) => v.includes("docker.sock"))).toBe(false)
    })

    it("applies memory_limit and cpu_limit from container config", () => {
      setupPersonaDir("alice")
      const persona = makePersonaWithContainer()
      persona.name = "alice"
      const compose = generateAndParse({ name: "alice", persona, port: 3100 })
      const engine = (compose.services as Record<string, Record<string, unknown>>).engine
      const deploy = engine.deploy as Record<string, Record<string, Record<string, string>>>
      expect(deploy.resources.limits.memory).toBe("256M")
      expect(deploy.resources.limits.cpus).toBe("0.5")
    })
  })
})
