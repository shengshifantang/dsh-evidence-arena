import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { inject, registerArenaSurfaces } from '../src/index.ts'
import type { ArenaService } from '../src/service.ts'

describe('Arena Host composition', () => {
  it('publishes only missing child-runtime bootstrap packages and marks stock Host peers as externally supplied', async () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(await readFile(`${packageRoot}/package.json`, 'utf8')) as {
      dependencies: Record<string, string>
      peerDependencies: Record<string, string>
      peerDependenciesMeta: Record<string, { optional?: boolean }>
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@deepseek-ai/dsh-agent-spine-demo',
      '@deepseek-ai/dsh-sdk-client',
      '@deepseek-ai/dsh-sdk-jsonrpc-demo',
      '@deepseek-ai/dsh-sdk-jsonrpc-server',
      '@deepseek-ai/dsh-sdk-protocol',
    ])
    expect(Object.keys(manifest.peerDependenciesMeta).sort()).toEqual(Object.keys(manifest.peerDependencies).sort())
    expect(Object.values(manifest.peerDependenciesMeta).every(value => value.optional === true)).toBe(true)
  })

  it('registers only fenced Workspace RPC channels and disposes all ownership', async () => {
    expect(inject).toEqual(['connection', 'subprocess', 'sandbox', 'credentials', 'workspaceRegistry'])
    expect(inject).not.toContain('commands')
    const ctx = new Context()
    const channels = new Map<string, {
      handler: ConnectionRpcHandler
      authority: string
    }>()
    const connection: HostConnectionHandle = {
      rpc: {
        handle(channel, handler, options) {
          channels.set(channel, { handler, authority: options.authority })
          return async () => { channels.delete(channel) }
        },
        intercept: () => { throw new Error('Arena must not intercept the shared API channel') },
      },
    }
    ctx.provide('connection', connection)
    ctx.provide('workspaceRegistry', {
      get: (id: string) => id === 'workspace-1' ? { id, path: '/fixture/repo', title: 'Fixture' } : undefined,
    } as never)
    const dispose = vi.fn(async () => {})
    const candidateFileDiff = vi.fn(async () => ({
      runId: 'arena-1', contenderId: 'direct', patchHash: 'a'.repeat(64),
      file: { path: 'app.txt', status: 'M', added: 1, deleted: 0, binary: false, untracked: false },
      diff: '+change\n', totalChars: 8, truncated: false,
    }))
    const started = { runId: 'arena-1', workspaceId: 'workspace-1' }
    const start = vi.fn(async () => started)
    const candidatePreview = {
      runId: 'arena-1', contenderId: 'direct', artifactHash: 'a'.repeat(64), status: 'idle',
      stdout: '', stderr: '', outputTruncated: false,
      safety: {
        explicitStartRequired: true, disposableWorktree: true, loopbackRequested: true,
        networkIsolated: false, hostReadsIsolated: false,
      },
    }
    const startCandidatePreview = vi.fn(async () => ({ ...candidatePreview, status: 'running' }))
    const stopCandidatePreview = vi.fn(async () => ({ ...candidatePreview, status: 'stopped' }))
    const recordHumanEvaluation = vi.fn(async () => started)
    const demoProject = {
      path: '/fixture/generated-demo', template: 'commonjs-sum' as const,
      createdAt: 2, suggestedTask: 'Fix the demo sum function.',
    }
    const createDemoProject = vi.fn(async () => demoProject)
    const report = vi.fn(() => ({ schemaVersion: 1, runId: 'arena-1', privacy: { reviewBeforeSharing: true } }))
    const service = {
      dispose,
      list: () => [],
      report,
      start,
      response: (run: unknown) => ({ run, pollAfterMs: 100 }),
      candidateFileDiff,
      candidatePreviewStatus: () => candidatePreview,
      startCandidatePreview,
      stopCandidatePreview,
      recordHumanEvaluation,
      createDemoProject,
    } as unknown as ArenaService

    const plugin = await ctx.plugin({
      inject: ['connection', 'workspaceRegistry'],
      apply: (inner) => { registerArenaSurfaces(inner, service) },
    }).await()
    expect([...channels.keys()].sort()).toEqual(['/arena-control', '/arena-read'])
    expect(channels.get('/arena-read')?.authority).toBe('trusted-host')
    expect(channels.get('/arena-control')?.authority).toBe('loopback')

    const read = channels.get('/arena-read')!
    await expect(read.handler('list', {}, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: [] })
    await expect(read.handler('report', { runId: 'arena-1' }, new AbortController().signal))
      .resolves.toMatchObject({ ok: true, value: { schemaVersion: 1, runId: 'arena-1' } })
    expect(report).toHaveBeenCalledWith('arena-1')
    await expect(read.handler('report', {}, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(read.handler('candidate-file-diff', {
      runId: 'arena-1', contenderId: 'direct', path: 'app.txt',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true, value: { runId: 'arena-1', contenderId: 'direct', file: { path: 'app.txt' } },
    })
    expect(candidateFileDiff).toHaveBeenCalledWith('arena-1', 'direct', 'app.txt')
    await expect(read.handler('candidate-preview', {
      runId: 'arena-1', contenderId: 'direct',
    }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { status: 'idle' } })

    const control = channels.get('/arena-control')!
    await expect(control.handler('demo-create', {}, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: demoProject })
    expect(createDemoProject).toHaveBeenCalledOnce()
    await expect(control.handler('start', {
      workspaceId: 'workspace-1', task: 'Implement a fixture',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true, value: { run: { runId: 'arena-1', workspaceId: 'workspace-1' } },
    })
    expect(start).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', cwd: '/fixture/repo', task: 'Implement a fixture',
      acknowledgeUnlimitedBudget: false,
    })
    await expect(control.handler('candidate-preview-start', {
      runId: 'arena-1', contenderId: 'direct', acknowledged: true,
    }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { status: 'running' } })
    expect(startCandidatePreview).toHaveBeenCalledWith('arena-1', 'direct', true)
    await expect(control.handler('candidate-preview-start', {
      runId: 'arena-1', contenderId: 'direct',
    }, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(control.handler('candidate-preview-stop', {
      runId: 'arena-1', contenderId: 'direct',
    }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { status: 'stopped' } })
    expect(stopCandidatePreview).toHaveBeenCalledWith('arena-1', 'direct')
    await expect(control.handler('human-evaluation', {
      runId: 'arena-1', contenderId: 'direct', verdict: 'passed', note: 'Works in the browser.', acknowledged: true,
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true, value: { run: { runId: 'arena-1', workspaceId: 'workspace-1' } },
    })
    expect(recordHumanEvaluation).toHaveBeenCalledWith(
      'arena-1', 'direct', 'passed', 'Works in the browser.', true,
    )
    await expect(control.handler('human-evaluation', {
      runId: 'arena-1', contenderId: 'direct', verdict: 'passed',
    }, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(control.handler('human-evaluation', {
      runId: 'arena-1', contenderId: 'direct', verdict: 'unknown', acknowledged: true,
    }, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(control.handler('start', {
      workspaceId: 'missing', task: 'Do not run',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: false, error: { code: 'command-error', message: 'Arena workspace not found: missing' },
    })
    await expect(control.handler('cancel', {}, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })

    await plugin.dispose()
    expect(channels).toHaveLength(0)
    expect(dispose).toHaveBeenCalledOnce()
  })
})
