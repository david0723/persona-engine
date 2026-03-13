import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { _setHomeForTesting } from "../utils/config.js"

export function useTempPersonaHome(): {
  home: string
  personaDir: (name: string) => string
  cleanup: () => void
} {
  const home = mkdtempSync(join(tmpdir(), "persona-engine-test-"))
  mkdirSync(join(home, "personas"), { recursive: true })
  _setHomeForTesting(home)

  return {
    home,
    personaDir: (name: string) => join(home, "personas", name),
    cleanup: () => {
      try {
        rmSync(home, { recursive: true, force: true })
      } catch { /* best effort */ }
    },
  }
}
