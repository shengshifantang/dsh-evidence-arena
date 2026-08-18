import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { ArenaLauncher } from '../src/client/ArenaLauncher.tsx'
import { ArenaWorkbench } from '../src/client/ArenaWorkbench.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { ArenaCardFace } from '../src/client/rpc.ts'
import { ARENA_REPORT_VERSION } from '../src/types.ts'

describe('Arena Web composition', () => {
  it('uses additive stock slots, shares one root store, validates RPC, and unloads cleanly', async () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'workspaces'])
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const report = {
      schemaVersion: ARENA_REPORT_VERSION,
      generatedAt: 1,
      runId: 'arena-9',
      task: 'Implement it',
      baseCommit: 'a'.repeat(40),
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      policy: {
        source: 'host-config', policyId: 'fixture', revision: '1', digest: 'b'.repeat(64),
        signature: { status: 'ignored' },
      },
      budget: {
        limits: { totalTokens: 0, modelCalls: 0, wallTimeMs: 60_000 },
        consumed: { totalTokens: 0, modelCalls: 0, wallTimeMs: 1 },
        status: 'within-budget', stopAfterApproved: 0, stoppedContenders: [],
      },
      contenders: [],
      privacy: {
        redactionsApplied: 0, truncationsApplied: 0, reviewBeforeSharing: true,
        omitted: ['raw evidence'],
      },
      limitations: ['One task is not accuracy.'],
    }
    const demo = {
      path: '/fixture/generated-demo', template: 'commonjs-sum' as const,
      createdAt: 2, suggestedTask: 'Fix the demo sum function.',
    }
    const call = vi.fn(async (_channel: string, endpoint: string) => endpoint === 'report'
      ? { ok: true as const, value: report }
      : endpoint === 'demo-create'
        ? { ok: true as const, value: demo }
        : {
          ok: false as const,
          error: { code: 'command-error' as const, message: 'fixture', details: {} },
        })
    const createWorkspace = vi.fn(async ({ path }: { path: string }) => ({ workspaceId: `workspace:${path}` }))
    const pickDirectory = vi.fn(async () => '/fixture/picked-project')
    const setCredential = vi.fn(async () => ({ result: { ok: true as const, value: undefined } }))
    ctx.provide('workspaces', { create: createWorkspace, pickDirectory } as never)
    ctx.provide('connection', {
      isLoopback: true,
      rpc: { call },
      api: { credentials: { set: setCredential } },
    } as never)

    const plugin = await ctx.plugin({ inject: [...inject], apply }).await()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)

    const declaration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)

    const launcher = ctx.slots.entries('sidebar.footer.action')[0]!
    expect(launcher.component).toBe(ArenaLauncher)
    expect(launcher.options).toMatchObject({ id: 'evidence-arena' })
    expect(launcher.locale).toBe('arena')
    const overlay = ctx.slots.entries('shell.overlay')[0]!
    expect(overlay.component).toBe(ArenaWorkbench)
    expect(overlay.options).toMatchObject({ id: 'evidence-arena-workbench' })
    expect(overlay.locale).toBe('arena')
    expect(launcher.store).toBe(overlay.store)

    const face = (overlay.inject as unknown as () => ArenaCardFace)()
    expect(face.isLoopback).toBe(true)
    await expect(face.addWorkspace()).resolves.toEqual({ workspaceId: 'workspace:/fixture/picked-project' })
    expect(pickDirectory).toHaveBeenCalledOnce()
    expect(createWorkspace).toHaveBeenCalledWith({ path: '/fixture/picked-project' })
    await expect(face.createDemoWorkspace()).resolves.toMatchObject({
      ...demo, workspaceId: 'workspace:/fixture/generated-demo',
    })
    expect(call).toHaveBeenCalledWith('/arena-control', 'demo-create', {})
    expect(createWorkspace).toHaveBeenCalledWith({ path: '/fixture/generated-demo' })
    await face.setCredential('DEEPSEEK_API_KEY', '  fixture-secret  ')
    expect(setCredential).toHaveBeenCalledWith({ ref: 'DEEPSEEK_API_KEY', value: 'fixture-secret' })
    await expect(face.list()).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-read', 'list', {})
    await expect(face.start('workspace-1', 'Implement it')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-control', 'start', {
      workspaceId: 'workspace-1', task: 'Implement it', acknowledgeUnlimitedBudget: false,
    })
    await expect(face.retry('arena-9')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-control', 'retry', { runId: 'arena-9', acknowledgeUnlimitedBudget: false })
    await expect(face.loadRun('arena-9')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-read', 'run', { runId: 'arena-9' })
    await expect(face.loadReport('arena-9')).resolves.toMatchObject({ runId: 'arena-9', schemaVersion: 1 })
    expect(call).toHaveBeenCalledWith('/arena-read', 'report', { runId: 'arena-9' })
    call.mockResolvedValueOnce({ ok: true as const, value: { ...report, repoRoot: '/must/not/leak' } })
    await expect(face.loadReport('arena-9')).rejects.toThrow('Arena report returned an invalid response')
    await expect(face.loadFileDiff('arena-9', 'evidence', 'src/answer.ts')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith(
      '/arena-read',
      'candidate-file-diff',
      { runId: 'arena-9', contenderId: 'evidence', path: 'src/answer.ts' },
    )
    await expect(face.loadCandidatePreview('arena-9', 'direct')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-read', 'candidate-preview', { runId: 'arena-9', contenderId: 'direct' })
    await expect(face.startCandidatePreview('arena-9', 'direct')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-control', 'candidate-preview-start', {
      runId: 'arena-9', contenderId: 'direct', acknowledged: true,
    })
    await expect(face.stopCandidatePreview('arena-9', 'direct')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-control', 'candidate-preview-stop', { runId: 'arena-9', contenderId: 'direct' })
    await expect(face.recordHumanEvaluation('arena-9', 'direct', 'failed', 'Submit is broken.'))
      .rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-control', 'human-evaluation', {
      runId: 'arena-9', contenderId: 'direct', verdict: 'failed', note: 'Submit is broken.', acknowledged: true,
    })
    await expect(face.loadSetup('workspace-1')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-read', 'setup', { workspaceId: 'workspace-1' })
    await expect(face.writePolicy('workspace-1', '{}')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-control', 'policy-write', { workspaceId: 'workspace-1', policyText: '{}' })

    await plugin.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
    declaration()
  })
})
