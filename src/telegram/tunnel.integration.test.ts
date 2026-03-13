import { describe, it, expect, afterEach } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { decodeToken, writeTunnelConfig, cleanupTunnelConfig } from "./tunnel.js"

// Valid test token: base64-encoded JSON with a, s, t fields
const testPayload = { a: "account-tag-123", s: "tunnel-secret-abc", t: "tunnel-id-xyz" }
const validToken = Buffer.from(JSON.stringify(testPayload)).toString("base64")

const cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs) {
    cleanupTunnelConfig(dir)
  }
  cleanupDirs.length = 0
})

describe("decodeToken", () => {
  it("decodes valid base64 token into accountTag, tunnelSecret, tunnelId", () => {
    const result = decodeToken(validToken)
    expect(result.accountTag).toBe("account-tag-123")
    expect(result.tunnelSecret).toBe("tunnel-secret-abc")
    expect(result.tunnelId).toBe("tunnel-id-xyz")
  })

  it("throws on invalid base64", () => {
    expect(() => decodeToken("not-valid-base64!!!")).toThrow()
  })

  it("throws on non-JSON base64", () => {
    const notJson = Buffer.from("this is not json").toString("base64")
    expect(() => decodeToken(notJson)).toThrow()
  })
})

describe("writeTunnelConfig", () => {
  it("creates temp dir with config.yml and credentials.json", () => {
    const result = writeTunnelConfig(validToken, "test.example.com", "http://engine:3100")
    cleanupDirs.push(result.dir)

    expect(existsSync(result.configPath)).toBe(true)
    expect(existsSync(result.credentialsPath)).toBe(true)
  })

  it("config.yml references container credentials path, not host path", () => {
    const result = writeTunnelConfig(validToken, "test.example.com", "http://engine:3100")
    cleanupDirs.push(result.dir)

    const config = readFileSync(result.configPath, "utf-8")
    expect(config).toContain("credentials-file: /etc/cloudflared/credentials.json")
    expect(config).not.toContain(result.dir)
  })

  it("config.yml has correct tunnel ID, hostname, service URL", () => {
    const result = writeTunnelConfig(validToken, "test.example.com", "http://engine:3100")
    cleanupDirs.push(result.dir)

    const config = readFileSync(result.configPath, "utf-8")
    expect(config).toContain("tunnel: tunnel-id-xyz")
    expect(config).toContain("hostname: test.example.com")
    expect(config).toContain("service: http://engine:3100")
  })

  it("credentials.json has correct AccountTag, TunnelSecret, TunnelID", () => {
    const result = writeTunnelConfig(validToken, "test.example.com", "http://engine:3100")
    cleanupDirs.push(result.dir)

    const creds = JSON.parse(readFileSync(result.credentialsPath, "utf-8"))
    expect(creds.AccountTag).toBe("account-tag-123")
    expect(creds.TunnelSecret).toBe("tunnel-secret-abc")
    expect(creds.TunnelID).toBe("tunnel-id-xyz")
  })

  it("ingress rules have hostname + catch-all 404", () => {
    const result = writeTunnelConfig(validToken, "test.example.com", "http://engine:3100")
    cleanupDirs.push(result.dir)

    const config = readFileSync(result.configPath, "utf-8")
    expect(config).toContain("ingress:")
    expect(config).toContain("service: http_status:404")
  })
})

describe("cleanupTunnelConfig", () => {
  it("removes temp directory", () => {
    const result = writeTunnelConfig(validToken, "test.example.com", "http://engine:3100")
    expect(existsSync(result.dir)).toBe(true)
    cleanupTunnelConfig(result.dir)
    expect(existsSync(result.dir)).toBe(false)
  })

  it("no-ops when directory doesn't exist", () => {
    expect(() => cleanupTunnelConfig("/tmp/nonexistent-tunnel-dir-12345")).not.toThrow()
  })
})
