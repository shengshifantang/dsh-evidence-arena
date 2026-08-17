/** Whole-run token, model-call, wall-time, and approval-triggered early-stop accounting. */

import type { ResolvedConfig } from './config.ts'
import type { ArenaRunBudget, ArenaRunState } from './types.ts'

/** Cancellation reason that distinguishes budget exhaustion from a user cancellation. */
export class ArenaBudgetExceededError extends Error {
  constructor(readonly fact: NonNullable<ArenaRunBudget['exhausted']>) {
    super(`Arena ${fact.kind} budget exhausted: observed ${fact.observed}, limit ${fact.limit}`)
    this.name = 'ArenaBudgetExceededError'
  }
}

/** Branch-local cancellation reason used after enough candidates are approved. */
export class ArenaEarlyStopError extends Error {
  constructor(readonly approved: number, readonly threshold: number) {
    super(`Arena early stop: ${approved} approved candidate(s) reached stopAfterApproved=${threshold}`)
    this.name = 'ArenaEarlyStopError'
  }
}

/** Initial durable budget projection for one admitted run. */
export function initialRunBudget(config: ResolvedConfig): ArenaRunBudget {
  return {
    limits: {
      totalTokens: config.maxRunTokens,
      modelCalls: config.maxRunModelCalls,
      wallTimeMs: config.runTimeoutMs,
    },
    consumed: { totalTokens: 0, modelCalls: 0, wallTimeMs: 0 },
    status: 'within-budget',
    stopAfterApproved: config.stopAfterApproved,
    stoppedContenders: [],
  }
}

/** Recompute disjoint aggregate counters from durable node projections. */
export function refreshRunBudget(state: ArenaRunState, now = Date.now()): void {
  let totalTokens = 0
  let modelCalls = 0
  for (const contender of state.contenders) {
    totalTokens += contender.progress.usage.totalTokens
    modelCalls += contender.progress.modelCalls
    for (const review of contender.reviews) {
      totalTokens += review.usage.totalTokens
      modelCalls += review.progress.modelCalls
    }
  }
  state.budget.consumed = {
    totalTokens,
    modelCalls,
    wallTimeMs: Math.max(0, now - state.createdAt),
  }
}

/** Return the first currently exhausted budget in stable priority order. */
export function currentBudgetExhaustion(
  state: ArenaRunState,
  now = Date.now(),
): NonNullable<ArenaRunBudget['exhausted']> | undefined {
  refreshRunBudget(state, now)
  const pairs = [
    ['totalTokens', state.budget.limits.totalTokens, state.budget.consumed.totalTokens],
    ['modelCalls', state.budget.limits.modelCalls, state.budget.consumed.modelCalls],
    ['wallTimeMs', state.budget.limits.wallTimeMs, state.budget.consumed.wallTimeMs],
  ] as const
  for (const [kind, limit, observed] of pairs) {
    if (limit > 0 && observed >= limit) return { kind, limit, observed, at: now }
  }
  return undefined
}
