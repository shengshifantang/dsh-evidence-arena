import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArenaStore } from '../src/store.ts'
import { ARENA_STATE_VERSION, zeroTokenUsage, type ArenaRunState } from '../src/types.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

async function root(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `dsh-arena-store-${label}-`))
  roots.push(path)
  return path
}

function state(runId: string, status: ArenaRunState['status']): ArenaRunState {
  const now = Date.now()
  return {
    version: ARENA_STATE_VERSION,
    runId,
    workspaceId: 'workspace',
    task: 'fixture task',
    repoRoot: '/fixture/repo',
    baseCommit: 'a'.repeat(40),
    status,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    policy: {
      source: 'host-config', policyId: 'fixture', revision: '1', digest: 'b'.repeat(64),
      signature: { status: 'ignored' },
      rules: {
        judgeCommands: [], requireChanges: true, requireProjectTests: false,
        requireLogicReview: false, requireSecurityReview: false, allowBinaryFiles: false,
        maxChangedFiles: 20, maxReviewInputChars: 10_000, protectedPathPatterns: [], sharedContextPaths: [],
      },
    },
    budget: {
      limits: { totalTokens: 0, modelCalls: 0, wallTimeMs: 60_000 },
      consumed: { totalTokens: 0, modelCalls: 0, wallTimeMs: 0 },
      status: 'within-budget', stopAfterApproved: 0, stoppedContenders: [],
    },
    contenders: [{
      id: 'one',
      label: 'One',
      provider: 'fixture',
      model: 'fixture',
      identity: {},
      credentialRefs: ['FIXTURE_API_KEY'],
      status: status === 'running' ? 'running' : 'passed',
      worktreePath: '/fixture/worktree',
      childSessionId: 'child',
      checkpoint: status === 'running' ? 'worktree-ready' : 'decision-complete',
      attempts: 1,
      progress: {
        notifications: 0, events: 0, toolCalls: 0, modelCalls: 0,
        usage: zeroTokenUsage(), activity: [],
      },
      reviews: [],
    }],
  }
}

describe('ArenaStore v4 recovery', () => {
  it('keeps live projections active so ArenaService can resume their checkpoints', async () => {
    const path = await root('restart')
    const first = new ArenaStore(path, () => {})
    await first.initialize()
    await first.create(state('run-restart', 'running'))

    const second = new ArenaStore(path, () => {})
    await second.initialize()
    expect(second.get('run-restart')?.snapshot()).toMatchObject({
      status: 'running',
      contenders: [{ status: 'running', checkpoint: 'worktree-ready' }],
    })
    expect(second.recoverable().map(record => record.snapshot().runId)).toEqual(['run-restart'])
  })

  it('indexes only non-terminal write-ahead promotion transactions for recovery', async () => {
    const path = await root('promotion')
    const store = new ArenaStore(path, () => {})
    await store.initialize()
    const record = await store.create(state('run-promotion', 'completed'))
    await record.update('run/promotion-transaction', 'prepared', (draft) => {
      draft.promotionTransaction = {
        id: 'transaction', contenderId: 'one', patchHash: 'c'.repeat(64), phase: 'applying',
        startedAt: Date.now(), updatedAt: Date.now(), copiedPaths: [],
      }
    })
    expect(store.incompletePromotions().map(item => item.snapshot().runId)).toEqual(['run-promotion'])
    await record.update('run/promotion-transaction', 'rolled back', (draft) => {
      draft.promotionTransaction!.phase = 'rolled-back'
    })
    expect(store.incompletePromotions()).toEqual([])
  })

  it('truncates a torn final append so later events remain readable', async () => {
    const path = await root('torn')
    const first = new ArenaStore(path, () => {})
    await first.initialize()
    await first.create(state('run-torn', 'completed'))
    const events = join(path, 'runs', 'run-torn', 'events.jsonl')
    await appendFile(events, `{"version":${ARENA_STATE_VERSION},"seq":`)

    const diagnostics: string[] = []
    const second = new ArenaStore(path, message => diagnostics.push(message))
    await second.initialize()
    expect(second.get('run-torn')?.snapshot().status).toBe('completed')
    expect(diagnostics).toEqual([expect.stringContaining('truncated it')])
    await second.get('run-torn')?.update('run/cleanup', 'write after repair', () => {})

    const third = new ArenaStore(path, () => {})
    await third.initialize()
    expect(third.get('run-torn')?.snapshot().revision).toBe(1)
    expect((await readFile(events, 'utf8')).endsWith('\n')).toBe(true)
  })

  it('rejects a complete corrupted event instead of disguising it as a torn append', async () => {
    const path = await root('corrupt')
    const first = new ArenaStore(path, () => {})
    await first.initialize()
    await first.create(state('run-corrupt', 'completed'))
    await appendFile(join(path, 'runs', 'run-corrupt', 'events.jsonl'), '{"not":"an event"}\n')

    const diagnostics: string[] = []
    const second = new ArenaStore(path, message => diagnostics.push(message))
    await second.initialize()
    expect(second.get('run-corrupt')).toBeUndefined()
    expect(diagnostics).toEqual([expect.stringContaining('was not loaded')])
  })
})
