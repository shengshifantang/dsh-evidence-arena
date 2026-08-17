/** Global Arena workbench: workspace selection, launch, history, setup, and evidence review. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { isActiveArenaStatus, type ArenaRunSummary } from '../types.ts'
import { ArenaCard } from './ArenaCard.tsx'
import type { ArenaCardFace } from './rpc.ts'
import type { ArenaWorkbenchStore } from './stores.ts'
import css from './ArenaWorkbench.module.css'

export type ArenaWorkbenchProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ArenaWorkbenchStore>
  & InjectFace<ArenaCardFace>
  & PropsLocale<'arena'>

function shortRunId(runId: string): string {
  return runId.length <= 24 ? runId : `${runId.slice(0, 15)}…${runId.slice(-8)}`
}

function formatTokens(value: number | undefined): string {
  if (value === undefined) return '—'
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard' }).format(value)
}

/** Render only while the shared root store is open; no chat Session is required. */
export function ArenaWorkbench({
  useWorkspaces,
  useStore,
  actions,
  isLoopback,
  list,
  start,
  retry,
  loadRun,
  loadFileDiff,
  loadSetup,
  writePolicy,
  cancel,
  cleanup,
  preview,
  confirm,
  t,
}: ArenaWorkbenchProps) {
  const open = useStore(state => state.open)
  const view = useStore(state => state.view)
  const workspaceId = useStore(state => state.workspaceId)
  const selectedRunId = useStore(state => state.runId)
  const workspaces = useWorkspaces(state => state.items)
  const recentWorkspaceId = useWorkspaces(state => state.recentWorkspaceId)
  const baselinesReady = useWorkspaces(state => state.baselinesReady)
  const [task, setTask] = useState('')
  const [runs, setRuns] = useState<readonly ArenaRunSummary[]>([])
  const [busy, setBusy] = useState<'start' | 'retry'>()
  const [error, setError] = useState<string>()

  const face: ArenaCardFace = useMemo(() => ({
    isLoopback, list, start, retry, loadRun, loadFileDiff, loadSetup, writePolicy,
    cancel, cleanup, preview, confirm,
  }), [cancel, cleanup, confirm, isLoopback, list, loadFileDiff, loadRun, loadSetup, preview, retry, start, writePolicy])

  useEffect(() => {
    if (!open) return
    if (workspaceId !== null && workspaces.some(item => String(item.workspaceId) === workspaceId)) return
    const fallback = workspaces.find(item => item.workspaceId === recentWorkspaceId) ?? workspaces[0]
    actions.selectWorkspace(fallback === undefined ? null : String(fallback.workspaceId))
  }, [actions, open, recentWorkspaceId, workspaceId, workspaces])

  const refreshRuns = useCallback(async (): Promise<void> => {
    try {
      const next = await list()
      setRuns(next)
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [list])

  useEffect(() => {
    if (!open) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async (): Promise<void> => {
      await refreshRuns()
      if (!stopped) timer = setTimeout(() => { void refresh() }, 1_000)
    }
    void refresh()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [open, refreshRuns])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') actions.setOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [actions, open])

  const workspaceRuns = useMemo(
    () => runs.filter(run => run.workspaceId === workspaceId),
    [runs, workspaceId],
  )

  useEffect(() => {
    if (selectedRunId !== null && workspaceRuns.some(run => run.runId === selectedRunId)) return
    actions.selectRun(workspaceRuns[0]?.runId ?? null)
  }, [actions, selectedRunId, workspaceRuns])

  const startRun = async (): Promise<void> => {
    if (workspaceId === null || task.trim().length === 0 || busy !== undefined) return
    setBusy('start')
    setError(undefined)
    try {
      const response = await start(workspaceId, task)
      actions.selectRun(response.run.runId)
      actions.showView('runs')
      setTask('')
      await refreshRuns()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const retryRun = async (): Promise<void> => {
    if (selectedRunId === null || busy !== undefined) return
    setBusy('retry')
    setError(undefined)
    try {
      const response = await retry(selectedRunId)
      actions.selectRun(response.run.runId)
      actions.showView('runs')
      await refreshRuns()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }

  if (!open) return null

  return (
    <div className={css.overlay} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) actions.setOpen(false)
    }}>
      <section className={css.workbench} role="dialog" aria-modal="true" aria-label={t('workbench.title')}>
        <header className={css.header}>
          <div className={css.brand}>
            <span className={css.brandMark} aria-hidden>A/B</span>
            <div><h2>{t('workbench.title')}</h2><p>{t('workbench.subtitle')}</p></div>
          </div>
          <label className={css.workspacePicker}>
            <span>{t('workbench.workspace')}</span>
            <select
              value={workspaceId ?? ''}
              disabled={!baselinesReady || workspaces.length === 0}
              onChange={(event) => { actions.selectWorkspace(event.currentTarget.value || null) }}
            >
              {workspaces.length === 0 && <option value="">{t('workbench.noWorkspace')}</option>}
              {workspaces.map(item => <option key={String(item.workspaceId)} value={String(item.workspaceId)}>{item.title}</option>)}
            </select>
          </label>
          <button type="button" className={css.closeButton} aria-label={t('workbench.close')} onClick={() => { actions.setOpen(false) }}>×</button>
        </header>

        <nav className={css.tabs} aria-label={t('workbench.views')}>
          <button type="button" data-selected={view === 'runs' || undefined} onClick={() => { actions.showView('runs') }}>{t('workbench.runs')}</button>
          <button type="button" data-selected={view === 'setup' || undefined} onClick={() => { actions.showView('setup') }}>{t('workbench.setup')}</button>
        </nav>

        {error !== undefined && <div className={css.error} role="alert">{error}</div>}
        {!isLoopback && <div className={css.readOnly}>{t('remoteReadOnly')}</div>}

        {workspaceId === null ? (
          <div className={css.emptyState}>{t('workbench.selectWorkspace')}</div>
        ) : view === 'setup' ? (
          <main className={css.setupView}>
            <ArenaCard view="setup" targetId={workspaceId} {...face} t={t} />
          </main>
        ) : (
          <main className={css.runView}>
            <aside className={css.runRail}>
              <form className={css.taskForm} onSubmit={(event) => { event.preventDefault(); void startRun() }}>
                <label htmlFor="arena-task">{t('workbench.task')}</label>
                <textarea
                  id="arena-task"
                  value={task}
                  maxLength={20_000}
                  placeholder={t('workbench.taskPlaceholder')}
                  onChange={(event) => { setTask(event.currentTarget.value) }}
                />
                <button type="submit" disabled={!isLoopback || busy !== undefined || task.trim().length === 0}>
                  {busy === 'start' ? t('workbench.starting') : t('workbench.start')}
                </button>
              </form>
              <div className={css.historyHead}><strong>{t('workbench.history')}</strong><span>{workspaceRuns.length}</span></div>
              <ol className={css.runList}>
                {workspaceRuns.map(run => (
                  <li key={run.runId}>
                    <button
                      type="button"
                      data-selected={selectedRunId === run.runId || undefined}
                      onClick={() => { actions.selectRun(run.runId); actions.showView('runs') }}
                    >
                      <span className={css.runTask}>{run.task}</span>
                      <span className={css.runMeta}><code>{shortRunId(run.runId)}</code><em data-active={isActiveArenaStatus(run.status) || undefined}>{run.status}</em></span>
                      <span className={css.runStats}>{t('metric.tokens')} {formatTokens(run.totalTokens)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
            <section className={css.detail}>
              {selectedRunId === null
                ? <div className={css.emptyState}>{t('workbench.noRuns')}</div>
                : <>
                    <div className={css.detailActions}>
                      <button type="button" disabled={!isLoopback || busy !== undefined} onClick={() => { void retryRun() }}>
                        {busy === 'retry' ? t('workbench.retrying') : t('workbench.retry')}
                      </button>
                    </div>
                    <ArenaCard view="run" targetId={selectedRunId} {...face} t={t} />
                  </>}
            </section>
          </main>
        )}
      </section>
    </div>
  )
}
