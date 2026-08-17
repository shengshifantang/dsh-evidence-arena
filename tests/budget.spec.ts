import { describe, expect, it } from 'vitest'
import { currentBudgetExhaustion, refreshRunBudget } from '../src/budget.ts'
import { ARENA_STATE_VERSION, zeroTokenUsage, type ArenaRunState } from '../src/types.ts'

function state(): ArenaRunState {
  const createdAt = 1_000
  return {
    version: ARENA_STATE_VERSION,
    runId: 'budget', workspaceId: 'workspace', task: 'task',
    repoRoot: '/repo', baseCommit: 'a'.repeat(40), status: 'running', revision: 0,
    createdAt, updatedAt: createdAt,
    policy: {
      source: 'host-config', policyId: 'host', revision: '1', digest: 'b'.repeat(64),
      signature: { status: 'ignored' },
      rules: {
        judgeCommands: [], requireChanges: true, requireProjectTests: false,
        requireLogicReview: false, requireSecurityReview: false, allowBinaryFiles: false,
        maxChangedFiles: 10, maxReviewInputChars: 10_000, protectedPathPatterns: [], sharedContextPaths: [],
      },
    },
    budget: {
      limits: { totalTokens: 100, modelCalls: 4, wallTimeMs: 1_000 },
      consumed: { totalTokens: 0, modelCalls: 0, wallTimeMs: 0 }, status: 'within-budget',
      stopAfterApproved: 0, stoppedContenders: [],
    },
    contenders: [{
      id: 'one', label: 'One', provider: 'p', model: 'm', identity: {}, credentialRefs: ['KEY'],
      status: 'running', worktreePath: '/one', childSessionId: 'one', checkpoint: 'worktree-ready', attempts: 1,
      progress: {
        notifications: 1, events: 1, toolCalls: 0, modelCalls: 2,
        usage: { ...zeroTokenUsage(), inputTokens: 60, outputTokens: 10, totalTokens: 70 }, activity: [],
      },
      reviews: [{
        id: 'review', label: 'Review', stage: 'logic', provider: 'q', model: 'n', identity: {},
        childSessionId: 'review', status: 'running', attempts: 1,
        usage: { ...zeroTokenUsage(), inputTokens: 25, outputTokens: 5, totalTokens: 30 },
        progress: { notifications: 1, events: 1, toolCalls: 0, modelCalls: 2, usage: zeroTokenUsage(), activity: [] },
        findings: [],
      }],
    }],
  }
}

describe('whole-run Arena budgets', () => {
  it('aggregates every Builder and Reviewer without double-counting usage', () => {
    const run = state()
    refreshRunBudget(run, 1_500)
    expect(run.budget.consumed).toEqual({ totalTokens: 100, modelCalls: 4, wallTimeMs: 500 })
  })

  it('reports token, model-call, and wall-time exhaustion in stable priority order', () => {
    const run = state()
    expect(currentBudgetExhaustion(run, 1_500)).toMatchObject({ kind: 'totalTokens', limit: 100, observed: 100 })
    run.budget.limits.totalTokens = 0
    expect(currentBudgetExhaustion(run, 1_500)).toMatchObject({ kind: 'modelCalls', limit: 4, observed: 4 })
    run.budget.limits.modelCalls = 0
    expect(currentBudgetExhaustion(run, 2_000)).toMatchObject({ kind: 'wallTimeMs', limit: 1_000, observed: 1_000 })
  })
})
