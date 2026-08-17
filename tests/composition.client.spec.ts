import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { ArenaLauncher } from '../src/client/ArenaLauncher.tsx'
import { ArenaWorkbench } from '../src/client/ArenaWorkbench.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { ArenaCardFace } from '../src/client/rpc.ts'

describe('Arena Web composition', () => {
  it('uses additive stock slots, shares one root store, validates RPC, and unloads cleanly', async () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const call = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'command-error' as const, message: 'fixture', details: {} },
    }))
    ctx.provide('connection', {
      isLoopback: true,
      rpc: { call },
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
    await expect(face.list()).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-read', 'list', {})
    await expect(face.start('workspace-1', 'Implement it')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-control', 'start', { workspaceId: 'workspace-1', task: 'Implement it' })
    await expect(face.retry('arena-9')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-control', 'retry', { runId: 'arena-9' })
    await expect(face.loadRun('arena-9')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith('/arena-read', 'run', { runId: 'arena-9' })
    await expect(face.loadFileDiff('arena-9', 'evidence', 'src/answer.ts')).rejects.toThrow('command-error: fixture')
    expect(call).toHaveBeenCalledWith(
      '/arena-read',
      'candidate-file-diff',
      { runId: 'arena-9', contenderId: 'evidence', path: 'src/answer.ts' },
    )
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
