import { describe, it, expect } from "vitest"
import { validatePersona } from "./loader.js"

function validPersonaData(): Record<string, unknown> {
  return {
    name: "TestBot",
    identity: {
      role: "A test bot",
      speaking_style: "concise",
      values: ["honesty"],
    },
    backstory: "Once upon a time...",
    instructions: "Be helpful.",
    heartbeat: {
      enabled: true,
      interval_minutes: 30,
      activities: ["reflect"],
    },
  }
}

describe("validatePersona", () => {
  describe("valid input", () => {
    it("accepts minimal valid persona", () => {
      const result = validatePersona(validPersonaData())
      expect(result.name).toBe("TestBot")
    })

    it("accepts fully populated persona with all optional sections", () => {
      const data = {
        ...validPersonaData(),
        container: { enabled: true, network: "bridge", memory_limit: "512m", cpu_limit: "1", allowed_env: ["FOO"] },
        permissions: { bash: "allow", edit: "ask", read: "deny", external_directory: "allow" },
        self_update: { enabled: true, repo_url: "https://example.com", branch: "main" },
      }
      expect(() => validatePersona(data)).not.toThrow()
    })
  })

  describe("required field errors", () => {
    it("throws when name is missing", () => {
      const data = validPersonaData()
      delete data.name
      expect(() => validatePersona(data)).toThrow("name must be a string")
    })

    it("throws when identity is missing", () => {
      const data = validPersonaData()
      delete data.identity
      expect(() => validatePersona(data)).toThrow("identity must be an object")
    })

    it("throws when identity.role is wrong type", () => {
      const data = validPersonaData()
      ;(data.identity as Record<string, unknown>).role = 42
      expect(() => validatePersona(data)).toThrow("identity.role must be a string")
    })

    it("throws when identity.speaking_style is wrong type", () => {
      const data = validPersonaData()
      ;(data.identity as Record<string, unknown>).speaking_style = null
      expect(() => validatePersona(data)).toThrow("identity.speaking_style must be a string")
    })

    it("throws when identity.values is not an array", () => {
      const data = validPersonaData()
      ;(data.identity as Record<string, unknown>).values = "not-array"
      expect(() => validatePersona(data)).toThrow("identity.values must be an array")
    })

    it("throws when backstory is missing", () => {
      const data = validPersonaData()
      delete data.backstory
      expect(() => validatePersona(data)).toThrow("backstory must be a string")
    })

    it("throws when instructions is missing", () => {
      const data = validPersonaData()
      delete data.instructions
      expect(() => validatePersona(data)).toThrow("instructions must be a string")
    })

    it("throws when heartbeat is missing", () => {
      const data = validPersonaData()
      delete data.heartbeat
      expect(() => validatePersona(data)).toThrow("heartbeat must be an object")
    })

    it("throws when heartbeat.enabled is wrong type", () => {
      const data = validPersonaData()
      ;(data.heartbeat as Record<string, unknown>).enabled = "yes"
      expect(() => validatePersona(data)).toThrow("heartbeat.enabled must be a boolean")
    })

    it("throws when heartbeat.interval_minutes is wrong type", () => {
      const data = validPersonaData()
      ;(data.heartbeat as Record<string, unknown>).interval_minutes = "30"
      expect(() => validatePersona(data)).toThrow("heartbeat.interval_minutes must be a number")
    })

    it("throws when heartbeat.activities is not an array", () => {
      const data = validPersonaData()
      ;(data.heartbeat as Record<string, unknown>).activities = "reflect"
      expect(() => validatePersona(data)).toThrow("heartbeat.activities must be an array")
    })

    it("collects multiple errors in one throw message", () => {
      const data = { name: 42 } as unknown as Record<string, unknown>
      expect(() => validatePersona(data)).toThrow(/name must be a string[\s\S]*backstory must be a string/)
    })
  })

  describe("optional section validation", () => {
    it("container.network rejects invalid values", () => {
      const data = { ...validPersonaData(), container: { network: "custom" } }
      expect(() => validatePersona(data)).toThrow('container.network must be')
    })

    it('container.network accepts "none", "bridge", "host"', () => {
      for (const net of ["none", "bridge", "host"]) {
        const data = { ...validPersonaData(), container: { network: net } }
        expect(() => validatePersona(data)).not.toThrow()
      }
    })

    it("permissions.bash rejects invalid values", () => {
      const data = { ...validPersonaData(), permissions: { bash: "maybe" } }
      expect(() => validatePersona(data)).toThrow('permissions.bash must be')
    })

    it('permissions.bash accepts "allow", "ask", "deny"', () => {
      for (const val of ["allow", "ask", "deny"]) {
        const data = { ...validPersonaData(), permissions: { bash: val } }
        expect(() => validatePersona(data)).not.toThrow()
      }
    })

    it("self_update.enabled must be boolean", () => {
      const data = { ...validPersonaData(), self_update: { enabled: "yes" } }
      expect(() => validatePersona(data)).toThrow("self_update.enabled must be a boolean")
    })

    it("self_update.repo_url must be string", () => {
      const data = { ...validPersonaData(), self_update: { enabled: true, repo_url: 123 } }
      expect(() => validatePersona(data)).toThrow("self_update.repo_url must be a string")
    })

    it("skips validation when optional sections are undefined", () => {
      const data = validPersonaData()
      expect(() => validatePersona(data)).not.toThrow()
    })
  })
})
