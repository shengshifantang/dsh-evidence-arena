// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { ArenaWorkbench, type ArenaWorkbenchProps } from '../src/client/ArenaWorkbench.tsx'
import { en } from '../src/client/locales.ts'
import { createArenaWorkbenchStore } from '../src/client/stores.ts'
import type { ArenaRunSummary, ArenaSetupReport } from '../src/types.ts'

afterEach(cleanup)

function staticHook<T>(snapshot: T): SnapshotSelectorHook<T> {
  return selector => selector(snapshot)
}

function mutableHook<T>(initial: T): { hook: SnapshotSelectorHook<T>; set: (next: T) => void } {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    hook: selector => useSyncExternalStore(
      listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      () => selector(snapshot),
      () => selector(snapshot),
    ),
    set(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

function readySetup(): ArenaSetupReport {
  return {
    workspaceId: 'workspace-1', repoRoot: '/fixture/repo', policyText: '', canWritePolicy: false,
    preflight: {
      ready: true, checkedAt: 1, blockers: [], warnings: [], routes: [], credentials: [], reviewCorrelations: [],
      budget: {
        limits: { totalTokens: 400_000, modelCalls: 48, wallTimeMs: 1_200_000 },
        stopAfterApproved: 0, unlimited: [], requiresAcknowledgement: false,
      },
      policy: {
        source: 'host-config', policyId: 'fixture', revision: '1', digest: 'd'.repeat(64),
        signature: { status: 'ignored' },
        rules: {
          judgeCommands: [], requireChanges: true, requireProjectTests: false,
          requireLogicReview: false, requireSecurityReview: false, allowBinaryFiles: false,
          maxChangedFiles: 20, maxReviewInputChars: 20_000, protectedPathPatterns: [], sharedContextPaths: [],
        },
      },
      remediations: [],
      gates: {
        requireProjectTests: false, requireLogicReview: false, requireSecurityReview: false,
        reviewerIndependence: 'warn', requireFullSandbox: true, revalidateOnPromotion: true, commands: [],
      },
      isolation: { fileEffects: 'harness-sandbox', networkIsolated: false, hostReadsIsolated: false },
    },
  }
}

describe('ArenaWorkbench', () => {
  it('creates and selects a runnable demo entirely from the Web onboarding screen', async () => {
    const handle = createArenaWorkbenchStore()
    const store = handle.create()
    store.actions.setOpen(true)
    const empty = {
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: null,
    }
    const workspaceSource = mutableHook(empty as never)
    const suggestedTask = 'Fix the generated sum function and run its tests.'
    const createDemoWorkspace = vi.fn(async () => {
      workspaceSource.set({
        ...empty,
        items: [{ workspaceId: 'workspace-demo', title: 'Arena demo', path: '/fixture/demo', sessionIds: [] }],
        recentWorkspaceId: 'workspace-demo',
      } as never)
      return {
        workspaceId: 'workspace-demo', path: '/fixture/demo', template: 'commonjs-sum' as const,
        createdAt: 2, suggestedTask,
      }
    })
    const useStore: ArenaWorkbenchProps['useStore'] = selector => useSyncExternalStore(
      listener => store.subscribe(listener),
      () => selector(store.getSnapshot()),
      () => selector(store.getSnapshot()),
    )

    render(<ArenaWorkbench
      useSessions={staticHook({}) as never}
      useWorkspaces={workspaceSource.hook}
      useStore={useStore}
      actions={store.actions}
      isLoopback
      addWorkspace={vi.fn()}
      createDemoWorkspace={createDemoWorkspace}
      setCredential={vi.fn()}
      list={vi.fn(async () => [])}
      start={vi.fn()}
      retry={vi.fn()}
      loadRun={vi.fn()}
      loadReport={vi.fn()}
      loadFileDiff={vi.fn()}
      loadCandidatePreview={vi.fn()}
      startCandidatePreview={vi.fn()}
      stopCandidatePreview={vi.fn()}
      recordHumanEvaluation={vi.fn()}
      loadSetup={vi.fn(async () => readySetup())}
      writePolicy={vi.fn()}
      cancel={vi.fn()}
      cleanup={vi.fn()}
      preview={vi.fn()}
      confirm={vi.fn()}
      t={key => key in en ? en[key as keyof typeof en] : key}
    />)

    expect(screen.getByText('Start with a project')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create demo project' }))
    await waitFor(() => { expect(createDemoWorkspace).toHaveBeenCalledOnce() })
    await waitFor(() => { expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('workspace-demo') })
    expect((screen.getByLabelText('Shared coding task') as HTMLTextAreaElement).value).toBe(suggestedTask)
    expect(screen.getByRole('status').textContent).toContain('The demo was created and selected')
  })

  it('starts from a Workspace without a chat Session and runs a fresh Web preflight before launch', async () => {
    const handle = createArenaWorkbenchStore()
    const store = handle.create()
    store.actions.setOpen(true)
    let started = false
    const summary: ArenaRunSummary = {
      runId: 'arena-1', workspaceId: 'workspace-1', task: 'Implement the fixture',
      status: 'queued', updatedAt: Date.now(), totalTokens: 0,
    }
    const prior: ArenaRunSummary = {
      runId: 'arena-old', workspaceId: 'workspace-1', task: 'Prior comparison',
      status: 'completed', updatedAt: Date.now() - 1_000, totalTokens: 10,
    }
    const list = vi.fn(async () => started ? [summary, prior] : [prior])
    const start = vi.fn(async () => {
      started = true
      return { run: { runId: 'arena-1' }, pollAfterMs: 1_000 } as never
    })
    const unlimitedSetup = readySetup()
    unlimitedSetup.preflight.budget = {
      limits: { totalTokens: 0, modelCalls: 0, wallTimeMs: 1_200_000 },
      stopAfterApproved: 0,
      unlimited: ['totalTokens', 'modelCalls'],
      requiresAcknowledgement: true,
    }
    const loadSetup = vi.fn(async () => unlimitedSetup)
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
      addWorkspace={vi.fn()}
      createDemoWorkspace={vi.fn()}
      setCredential={vi.fn()}
      list={list}
      start={start}
      retry={vi.fn()}
      loadRun={vi.fn(async (): Promise<never> => { throw new Error('run fixture') })}
      loadReport={vi.fn(async (): Promise<never> => { throw new Error('report fixture') })}
      loadFileDiff={vi.fn()}
      loadCandidatePreview={vi.fn()}
      startCandidatePreview={vi.fn()}
      stopCandidatePreview={vi.fn()}
      recordHumanEvaluation={vi.fn()}
      loadSetup={loadSetup}
      writePolicy={vi.fn()}
      cancel={vi.fn()}
      cleanup={vi.fn()}
      preview={vi.fn()}
      confirm={vi.fn()}
      t={key => key in en ? en[key as keyof typeof en] : key}
    />)

    expect(screen.getByRole('dialog', { name: 'Evidence Arena' })).toBeTruthy()
    await waitFor(() => { expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('workspace-1') })
    await waitFor(() => { expect(loadSetup).toHaveBeenCalledWith('workspace-1') })
    await waitFor(() => { expect(store.getSnapshot().runId).toBe('arena-old') })
    fireEvent.change(screen.getByLabelText('Shared coding task'), { target: { value: 'Implement the fixture' } })
    expect((screen.getByRole('button', { name: 'Start parallel comparison' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /I acknowledge that the token or model-call budget is unlimited/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start parallel comparison' }))
    await waitFor(() => { expect(loadSetup).toHaveBeenCalledWith('workspace-1') })
    await waitFor(() => { expect(start).toHaveBeenCalledWith('workspace-1', 'Implement the fixture', { acknowledgeUnlimitedBudget: true }) })
    await waitFor(() => { expect(store.getSnapshot().runId).toBe('arena-1') })
    expect(await screen.findByText('Implement the fixture')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Setup and preflight' }))
    await waitFor(() => { expect(loadSetup.mock.calls.length).toBeGreaterThanOrEqual(2) })
    expect(await screen.findByText('Arena setup and preflight')).toBeTruthy()
    store.actions.selectRun(null)
    expect(store.getSnapshot().view).toBe('setup')
  })

  it('keeps a start failure visible after successful history polling', async () => {
    const handle = createArenaWorkbenchStore()
    const store = handle.create()
    store.actions.setOpen(true)
    const list = vi.fn(async (): Promise<readonly ArenaRunSummary[]> => [])
    const start = vi.fn(async (): Promise<never> => {
      throw new Error('Arena preflight blocked: missing credential')
    })
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
      addWorkspace={vi.fn()}
      createDemoWorkspace={vi.fn()}
      setCredential={vi.fn()}
      list={list}
      start={start}
      retry={vi.fn()}
      loadRun={vi.fn(async (): Promise<never> => { throw new Error('run fixture') })}
      loadReport={vi.fn(async (): Promise<never> => { throw new Error('report fixture') })}
      loadFileDiff={vi.fn()}
      loadCandidatePreview={vi.fn()}
      startCandidatePreview={vi.fn()}
      stopCandidatePreview={vi.fn()}
      recordHumanEvaluation={vi.fn()}
      loadSetup={vi.fn(async () => readySetup())}
      writePolicy={vi.fn()}
      cancel={vi.fn()}
      cleanup={vi.fn()}
      preview={vi.fn()}
      confirm={vi.fn()}
      t={key => key in en ? en[key as keyof typeof en] : key}
    />)

    await waitFor(() => { expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('workspace-1') })
    fireEvent.change(screen.getByLabelText('Shared coding task'), { target: { value: 'Implement the fixture' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start parallel comparison' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Arena preflight blocked: missing credential')

    await waitFor(() => { expect(list.mock.calls.length).toBeGreaterThanOrEqual(2) }, { timeout: 2_500 })
    expect(screen.getByRole('alert').textContent).toContain('Arena preflight blocked: missing credential')
  })
})
