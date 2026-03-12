export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface TokenBudget {
  identity: number
  coreMemories: number
  journals: number
  summaries: number
  currentSession: number
}

export const DEFAULT_BUDGET: TokenBudget = {
  identity: 2000,
  coreMemories: 3000,
  journals: 3000,
  summaries: 5000,
  currentSession: 15000,
}
