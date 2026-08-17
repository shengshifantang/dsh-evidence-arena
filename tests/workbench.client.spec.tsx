// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { ArenaWorkbench, type ArenaWorkbenchProps } from '../src/client/ArenaWorkbench.tsx'
import { en } from '../src/client/locales.ts'
import { createArenaWorkbenchStore } from '../src/client/stores.ts'
import type { ArenaRunSummary } from '../src/types.ts'

afterEach(cleanup)

function staticHook<T>(snapshot: T): SnapshotSelectorHook<T> {
  return selector => selector(snapshot)
}

describe('ArenaWorkbench', () => {
  it('starts from a Workspace without a chat Session and opens preflight only on request', async () => {
    const handle = createArenaWorkbenchStore()
    const store = handle.create()
    store.actions.setOpen(true)
    let started = false
    const summary: ArenaRunSummary = {
      runId: 'arena-1', workspaceId: 'workspace-1', task: 'Implement the fixture',
      status: 'queued', updatedAt: Date.now(), totalTokens: 0,
    }
    const list = vi.fn(async () => started ? [summary] : [])
    const start = vi.fn(async () => {
      started = true
      return { run: { runId: 'arena-1' }, pollAfterMs: 1_000 } as never
    })
    const loadSetup = vi.fn(async (): Promise<never> => { throw new Error('preflight fixture') })
    const useStore: ArenaWorkbenchProps['useStore'] = selector => useSyncExternalStore(
      listener => store.subscribe(listener),
      () => selector(store.getSnapshot()),
      () => selector(store.getSnapshot()),
    )
    const workspaces = {
      items: [{ workspaceId: 'workspace-1', title: 'Fixture workspace', path: '/fixture/repo', sessionIds: [] }],
      archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: 'workspace-1',
    } as never

    render(<ArenaWorkbench
      useSessions={staticHook({}) as never}
      useWorkspaces={staticHook(workspaces)}
      useStore={useStore}
      actions={store.actions}
      isLoopback
      list={list}
      start={start}
      retry={vi.fn()}
      loadRun={vi.fn(async (): Promise<never> => { throw new Error('run fixture') })}
      loadFileDiff={vi.fn()}
      loadSetup={loadSetup}
      writePolicy={vi.fn()}
      cancel={vi.fn()}
      cleanup={vi.fn()}
      preview={vi.fn()}
      confirm={vi.fn()}
      t={key => key in en ? en[key as keyof typeof en] : key}
    />)

    expect(screen.getByRole('dialog', { name: 'Evidence Arena' })).toBeTruthy()
    expect(loadSetup).not.toHaveBeenCalled()
    await waitFor(() => { expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('workspace-1') })
    fireEvent.change(screen.getByLabelText('Shared coding task'), { target: { value: 'Implement the fixture' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start parallel comparison' }))
    await waitFor(() => { expect(start).toHaveBeenCalledWith('workspace-1', 'Implement the fixture') })
    expect(await screen.findByText('Implement the fixture')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Setup and preflight' }))
    await waitFor(() => { expect(loadSetup).toHaveBeenCalledWith('workspace-1') })
    expect(await screen.findByText('preflight fixture')).toBeTruthy()
    store.actions.selectRun(null)
    expect(store.getSnapshot().view).toBe('setup')
  })
})
