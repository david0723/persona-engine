/**
 * Vault metrics logger.
 * Appends timestamped events to Metrics/YYYY-MM-DD.md in the vault.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"

export type MetricSource = "telegram" | "schedule" | "heartbeat" | "cli" | "system"
export type MetricOutcome = "ok" | "error" | "timeout" | "skipped"

interface MetricEvent {
  source: MetricSource
  label: string
  outcome: MetricOutcome
  durationMs?: number
  error?: string
}

export class MetricsLogger {
  private metricsDir: string

  constructor(vaultPath: string) {
    this.metricsDir = join(vaultPath, "Metrics")
  }

  /** Log a metric event to today's file */
  log(event: MetricEvent): void {
    if (!existsSync(this.metricsDir)) {
      try {
        mkdirSync(this.metricsDir, { recursive: true })
      } catch {
        return // Can't create metrics dir, skip silently
      }
    }

    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    const time = now.toISOString().slice(11, 16)
    const filepath = join(this.metricsDir, `${date}.md`)

    const duration = event.durationMs ? ` (${(event.durationMs / 1000).toFixed(1)}s)` : ""
    const error = event.error ? ` - ${event.error}` : ""
    const line = `- ${time} [${event.source}] ${event.label} -> ${event.outcome}${duration}${error}\n`

    try {
      // Create file with header if it doesn't exist
      if (!existsSync(filepath)) {
        appendFileSync(filepath, `# Metrics - ${date}\n\n`, "utf-8")
      }
      appendFileSync(filepath, line, "utf-8")
    } catch {
      // Metrics are best-effort, don't crash on failure
    }
  }

  /** Convenience: log a Telegram message event */
  logTelegram(preview: string, outcome: MetricOutcome, durationMs?: number, error?: string): void {
    this.log({
      source: "telegram",
      label: `"${preview.slice(0, 60)}${preview.length > 60 ? "..." : ""}"`,
      outcome,
      durationMs,
      error,
    })
  }

  /** Convenience: log a schedule execution */
  logSchedule(label: string, outcome: MetricOutcome, durationMs?: number, error?: string): void {
    this.log({
      source: "schedule",
      label,
      outcome,
      durationMs,
      error,
    })
  }

  /** Convenience: log a heartbeat */
  logHeartbeat(outcome: MetricOutcome, durationMs?: number, error?: string): void {
    this.log({
      source: "heartbeat",
      label: "heartbeat",
      outcome,
      durationMs,
      error,
    })
  }
}

/** Create a MetricsLogger if vault is enabled, otherwise return a no-op logger */
export function createMetricsLogger(vaultPath?: string): MetricsLogger | null {
  if (!vaultPath) return null
  return new MetricsLogger(vaultPath)
}
