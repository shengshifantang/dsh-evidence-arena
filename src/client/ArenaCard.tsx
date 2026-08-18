/** Decision-first comparison and guarded-promotion card for one durable Arena run. */

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  isActiveArenaStatus,
  type ArenaCandidatePreview,
  type ArenaCheckResult,
  type ArenaContenderState,
  type ArenaGateStage,
  type ArenaHumanEvaluation,
  type ArenaPromotionPreview,
  type ArenaReviewState,
  type ArenaRunState,
  type ArenaSecurityFinding,
  type ArenaSetupReport,
} from '../types.ts'
import type { ArenaCardFace } from './rpc.ts'
import type { ArenaKey } from './locales.ts'
import { ArenaDiffReview } from './ArenaDiffReview.tsx'
import css from './ArenaCard.module.css'

export type ArenaCardProps = {
  /** Which standalone workbench surface this card renders. */
  view: 'setup' | 'run'
  /** Workspace id for setup, run id for run detail. */
  targetId: string
} & ArenaCardFace & PropsLocale<'arena'>

const STAGES: readonly ArenaGateStage[] = ['integrity', 'quality', 'test', 'logic', 'security']

function statusKey(status: string): ArenaKey {
  switch (status) {
    case 'queued': return 'status.queued'
    case 'preparing': return 'status.preparing'
    case 'recovering': return 'status.recovering'
    case 'running': return 'status.running'
    case 'judging': return 'status.judging'
    case 'reviewing': return 'status.reviewing'
    case 'completed': return 'status.completed'
    case 'failed': return 'status.failed'
    case 'cancelled': return 'status.cancelled'
    case 'budget-exhausted': return 'status.budgetExhausted'
    case 'passed':
    case 'approved': return 'status.passed'
    case 'evaluation-unavailable': return 'status.evaluationUnavailable'
    case 'rejected': return 'status.rejected'
    case 'skipped': return 'status.skipped'
    default: return 'status.error'
  }
}

function stageKey(stage: ArenaGateStage): ArenaKey {
  return `stage.${stage}`
}

function shortCommit(value: string): string {
  return value.slice(0, 10)
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.max(0, milliseconds)}ms`
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 100) / 10}s`
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.round((milliseconds % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard' }).format(value)
}

function checkDetail(check: ArenaCheckResult): string {
  return [check.stderr, check.stdout].filter(value => value.trim().length > 0).join('\n').trim()
}

function contenderDuration(contender: ArenaContenderState): number {
  if (contender.builderDurationMs !== undefined) return contender.builderDurationMs
  if (contender.startedAt === undefined) return 0
  return (contender.finishedAt ?? Date.now()) - contender.startedAt
}

function minimumIds(
  contenders: readonly ArenaContenderState[],
  metric: (contender: ArenaContenderState) => number | undefined,
): Set<string> {
  const measured = contenders.flatMap((contender) => {
    const value = metric(contender)
    return value === undefined ? [] : [{ id: contender.id, value }]
  })
  if (measured.length === 0) return new Set()
  const minimum = Math.min(...measured.map(item => item.value))
  return new Set(measured.filter(item => item.value === minimum).map(item => item.id))
}

function ComparisonSummary({
  contenders,
  winnerId,
  t,
}: {
  contenders: readonly ArenaContenderState[]
  winnerId: string | undefined
  t: ArenaCardProps['t']
}) {
  const fastest = minimumIds(contenders, contender => contender.builderDurationMs)
  const lowestTokens = minimumIds(
    contenders,
    contender => contender.progress.modelCalls > 0 && contender.progress.usage.totalTokens > 0
      ? contender.progress.usage.totalTokens
      : undefined,
  )
  const smallestChange = minimumIds(contenders, contender => contender.evidence === undefined
    ? undefined
    : contender.evidence.addedLines + contender.evidence.deletedLines)

  return (
    <section className={css.comparisonSummary} aria-label={t('comparison.title')}>
      <header>
        <div><h4>{t('comparison.title')}</h4><p>{t('comparison.subtitle')}</p></div>
      </header>
      <div className={css.comparisonTable} role="table">
        <div className={css.comparisonRow} role="row" data-header>
          <span role="columnheader">{t('comparison.candidate')}</span>
          <span role="columnheader">{t('comparison.verdict')}</span>
          <span role="columnheader">{t('comparison.gates')}</span>
          <span role="columnheader">{t('comparison.builderTime')}</span>
          <span role="columnheader">{t('comparison.tokens')}</span>
          <span role="columnheader">{t('comparison.changes')}</span>
          <span role="columnheader">{t('comparison.signals')}</span>
        </div>
        {contenders.map((contender) => {
          const stages = contender.evidence?.decision.stages ?? []
          const requiredNodes = stages.reduce((total, stage) => total + stage.requiredNodes, 0)
          const passedNodes = stages.reduce((total, stage) => total + stage.passedNodes, 0)
          const unavailable = stages.some(stage => stage.status === 'unavailable')
          const verdict = contender.evidence?.decision.status === 'approved'
            ? t('status.passed')
            : unavailable ? t('comparison.unavailable') : t(statusKey(contender.status))
          const signals = [
            ...(winnerId === contender.id ? [{ key: 'leader', label: t('comparison.mechanicalLeader') }] : []),
            ...(fastest.has(contender.id) ? [{ key: 'fastest', label: t('comparison.fastest') }] : []),
            ...(lowestTokens.has(contender.id) ? [{ key: 'tokens', label: t('comparison.lowestTokens') }] : []),
            ...(smallestChange.has(contender.id) ? [{ key: 'change', label: t('comparison.smallestChange') }] : []),
          ]
          return (
            <div className={css.comparisonRow} role="row" key={contender.id}>
              <span role="cell"><strong>{contender.label}</strong><small>{contender.provider} / {contender.model}</small></span>
              <span role="cell">{verdict}</span>
              <span role="cell">{contender.evidence === undefined ? '—' : `${passedNodes}/${requiredNodes}`}</span>
              <span role="cell">{contender.builderDurationMs === undefined ? '—' : formatDuration(contender.builderDurationMs)}</span>
              <span role="cell">{contender.progress.modelCalls === 0 || contender.progress.usage.totalTokens === 0 ? '—' : formatTokens(contender.progress.usage.totalTokens)}</span>
              <span role="cell">{contender.evidence === undefined ? '—' : `+${contender.evidence.addedLines} / −${contender.evidence.deletedLines}`}</span>
              <span role="cell" className={css.comparisonSignals}>{signals.length === 0
                ? '—'
                : signals.map(signal => <em key={signal.key} data-kind={signal.key}>{signal.label}</em>)}</span>
            </div>
          )
        })}
      </div>
      <p className={css.comparisonCaveat}>{t('comparison.caveat')}</p>
    </section>
  )
}

function StageRail({ contender, t }: { contender: ArenaContenderState; t: ArenaCardProps['t'] }) {
  return (
    <ol className={css.stageRail} aria-label={t('stages')}>
      {STAGES.map((stage) => {
        const decision = contender.evidence?.decision.stages.find(item => item.stage === stage)
        const status = decision?.status ?? 'pending'
        return (
          <li key={stage} data-status={status}>
            <span className={css.stageIcon} aria-hidden>{status === 'approved' ? '✓' : status === 'rejected' ? '!' : status === 'unavailable' ? '?' : status === 'not-configured' ? '–' : '·'}</span>
            <span>{t(stageKey(stage))}</span>
            {decision !== undefined && <small>{decision.passedNodes}/{decision.requiredNodes}</small>}
          </li>
        )
      })}
    </ol>
  )
}

function Findings({ findings, t }: { findings: readonly ArenaSecurityFinding[]; t: ArenaCardProps['t'] }) {
  if (findings.length === 0) return <p className={css.empty}>{t('security.empty')}</p>
  return (
    <ul className={css.findingList}>
      {findings.map((finding, index) => (
        <li key={`${finding.ruleId}-${finding.path}-${finding.line ?? 0}-${index}`} data-severity={finding.severity}>
          <span className={css.severity}>{finding.severity}</span>
          <code>{finding.path}{finding.line === undefined ? '' : `:${finding.line}`}</code>
          <p>{finding.message}</p>
        </li>
      ))}
    </ul>
  )
}

function ReviewNode({ review, t }: { review: ArenaReviewState; t: ArenaCardProps['t'] }) {
  const failure = review.failureCode === 'output-exhausted'
    ? t('review.outputExhausted')
    : review.failureCode === 'invalid-output' ? t('review.invalidOutput')
      : review.failureCode === 'runtime-error' ? t('review.runtimeError') : undefined
  return (
    <article className={css.reviewNode} data-status={review.status}>
      <header>
        <div>
          <strong>{review.label}</strong>
          <span>{review.provider} / {review.model}</span>
        </div>
        <span className={css.statusPill} data-status={review.status}>{t(statusKey(review.status))}</span>
      </header>
      <div className={css.nodeMetrics}>
        <span>{t('metric.duration')} {formatDuration(review.durationMs ?? 0)}</span>
        <span>{t('metric.tokens')} {formatTokens(review.usage.totalTokens)}</span>
        <span>{t('metric.calls')} {review.progress.modelCalls}</span>
        {(review.repairAttempts ?? 0) > 0 && <span>{t('review.repairs')} {review.repairAttempts}</span>}
      </div>
      {review.summary !== undefined && <p className={css.reviewSummary}>{review.summary}</p>}
      {failure !== undefined && <p className={css.reviewUnavailable}>{failure}</p>}
      {review.error !== undefined && <p className={css.inlineError}>{review.error}</p>}
      {review.findings.length > 0 && <Findings findings={review.findings} t={t} />}
    </article>
  )
}

function CandidatePreviewPanel({
  runId,
  contender,
  canControl,
  loadCandidatePreview,
  startCandidatePreview,
  stopCandidatePreview,
  recordHumanEvaluation,
  onRunUpdate,
  t,
}: {
  runId: string
  contender: ArenaContenderState
  canControl: boolean
  loadCandidatePreview: ArenaCardFace['loadCandidatePreview']
  startCandidatePreview: ArenaCardFace['startCandidatePreview']
  stopCandidatePreview: ArenaCardFace['stopCandidatePreview']
  recordHumanEvaluation: ArenaCardFace['recordHumanEvaluation']
  onRunUpdate: (run: ArenaRunState) => void
  t: ArenaCardProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const [preview, setPreview] = useState<ArenaCandidatePreview>()
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState<'start' | 'stop' | 'uat'>()
  const [error, setError] = useState<string>()
  const [humanVerdict, setHumanVerdict] = useState<ArenaHumanEvaluation['verdict'] | ''>(
    contender.humanEvaluation?.verdict ?? '',
  )
  const [humanNote, setHumanNote] = useState(contender.humanEvaluation?.note ?? '')
  const [humanNotice, setHumanNotice] = useState<string>()

  useEffect(() => {
    setHumanVerdict(contender.humanEvaluation?.verdict ?? '')
    setHumanNote(contender.humanEvaluation?.note ?? '')
  }, [contender.humanEvaluation?.note, contender.humanEvaluation?.recordedAt, contender.humanEvaluation?.verdict])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setPreview(await loadCandidatePreview(runId, contender.id))
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [contender.id, loadCandidatePreview, runId])

  useEffect(() => {
    if (!expanded || contender.evidence === undefined) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      await refresh()
      if (!stopped && (preview?.status === 'starting' || preview?.status === 'running')) {
        timer = setTimeout(() => { void read() }, 1_000)
      }
    }
    void read()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  // Preview status deliberately controls whether polling continues.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contender.evidence, expanded, refresh, preview?.status])

  if (contender.evidence === undefined) return null
  if (!expanded) {
    return (
      <button type="button" className={css.previewDisclosureButton} onClick={() => { setExpanded(true) }}>
        <span><strong>{t('candidatePreview.title')}</strong><small>{t('candidatePreview.subtitle')}</small></span>
        <span>{t('candidatePreview.expand')} ›</span>
      </button>
    )
  }
  const start = async (): Promise<void> => {
    if (!acknowledged) return
    setBusy('start')
    setError(undefined)
    try {
      setPreview(await startCandidatePreview(runId, contender.id))
      setAcknowledged(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }
  const stop = async (): Promise<void> => {
    setBusy('stop')
    setError(undefined)
    try {
      setPreview(await stopCandidatePreview(runId, contender.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }
  const saveHumanEvaluation = async (): Promise<void> => {
    if (humanVerdict === '') return
    setBusy('uat')
    setError(undefined)
    setHumanNotice(undefined)
    try {
      const response = await recordHumanEvaluation(
        runId,
        contender.id,
        humanVerdict,
        humanNote.trim().length === 0 ? undefined : humanNote.trim(),
      )
      onRunUpdate(response.run)
      setHumanNotice(t('candidatePreview.uatSaved'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }
  const startable = preview === undefined || ['idle', 'stopped', 'failed'].includes(preview.status)
  const previewReady = preview?.readyAt !== undefined
  const logs = [preview?.stdout, preview?.stderr].filter(value => value !== undefined && value.trim().length > 0).join('\n')
  return (
    <section className={css.candidatePreview} data-status={preview?.status ?? 'idle'}>
      <header>
        <div><strong>{t('candidatePreview.title')}</strong><span>{t('candidatePreview.subtitle')}</span></div>
        <button type="button" className={css.previewCollapse} onClick={() => { setExpanded(false) }}>{t('candidatePreview.collapse')}</button>
      </header>
      <span className={css.statusPill} data-status={preview?.status ?? 'idle'}>{t(`candidatePreview.status.${preview?.status ?? 'idle'}` as ArenaKey)}</span>
      <p className={css.previewWarning}>{t('candidatePreview.warning')}</p>
      {preview?.launch !== undefined && <code className={css.previewRecipe}>{preview.launch.label}: {preview.launch.argv.join(' ')}</code>}
      {preview?.url !== undefined && (
        <a className={css.previewLink} href={preview.url} target="_blank" rel="noreferrer">{t('candidatePreview.open')} ↗</a>
      )}
      {(error ?? preview?.error) !== undefined && <p className={css.inlineError}>{error ?? preview?.error}</p>}
      {logs.length > 0 && (
        <details className={css.disclosure}>
          <summary>{t('candidatePreview.logs')}{preview?.outputTruncated === true ? ` · ${t('truncated')}` : ''}</summary>
          <pre className={css.prose}>{logs}</pre>
        </details>
      )}
      {startable && (
        <label className={css.acknowledgement}>
          <input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.currentTarget.checked) }} />
          <span>{t('candidatePreview.acknowledge')}</span>
        </label>
      )}
      <div className={css.previewActions}>
        {startable && <button type="button" className={css.secondaryButton} disabled={!canControl || !acknowledged || busy !== undefined} onClick={() => { void start() }}>{busy === 'start' ? t('candidatePreview.starting') : t('candidatePreview.start')}</button>}
        {(preview?.status === 'starting' || preview?.status === 'running') && <button type="button" className={css.secondaryButton} disabled={!canControl || busy !== undefined} onClick={() => { void stop() }}>{busy === 'stop' ? t('candidatePreview.stopping') : t('candidatePreview.stop')}</button>}
      </div>
      {(previewReady || contender.humanEvaluation !== undefined) && (
        <section className={css.humanEvaluation}>
          <header>
            <div><strong>{t('candidatePreview.uatTitle')}</strong><span>{t('candidatePreview.uatSubtitle')}</span></div>
            {contender.humanEvaluation !== undefined && (
              <span className={css.uatVerdict} data-verdict={contender.humanEvaluation.verdict}>
                {t(`candidatePreview.uat.${contender.humanEvaluation.verdict}` as ArenaKey)}
              </span>
            )}
          </header>
          {contender.humanEvaluation !== undefined && (
            <div className={css.uatRecord}>
              <span>{t('candidatePreview.uatRecorded')} {new Date(contender.humanEvaluation.recordedAt).toLocaleString()}</span>
              {contender.humanEvaluation.note !== undefined && <p>{contender.humanEvaluation.note}</p>}
            </div>
          )}
          <p className={css.uatBoundary}>{t('candidatePreview.uatBoundary')}</p>
          {!previewReady && <p className={css.uatUnavailable}>{t('candidatePreview.uatRerun')}</p>}
          <div className={css.uatForm}>
            <label>
              <span>{t('candidatePreview.uatVerdict')}</span>
              <select
                value={humanVerdict}
                disabled={!canControl || !previewReady || busy !== undefined}
                onChange={event => { setHumanVerdict(event.currentTarget.value as ArenaHumanEvaluation['verdict'] | '') }}
              >
                <option value="">{t('candidatePreview.uatSelect')}</option>
                <option value="passed">{t('candidatePreview.uat.passed')}</option>
                <option value="failed">{t('candidatePreview.uat.failed')}</option>
                <option value="inconclusive">{t('candidatePreview.uat.inconclusive')}</option>
              </select>
            </label>
            <label>
              <span>{t('candidatePreview.uatNote')}</span>
              <textarea
                value={humanNote}
                maxLength={2_000}
                disabled={!canControl || !previewReady || busy !== undefined}
                placeholder={t('candidatePreview.uatNotePlaceholder')}
                onChange={event => { setHumanNote(event.currentTarget.value) }}
              />
            </label>
            <div className={css.uatActions}>
              <small>{humanNote.length}/2000</small>
              <button type="button" className={css.secondaryButton} disabled={!canControl || !previewReady || humanVerdict === '' || busy !== undefined} onClick={() => { void saveHumanEvaluation() }}>
                {busy === 'uat' ? t('candidatePreview.uatSaving') : t('candidatePreview.uatSave')}
              </button>
            </div>
          </div>
          {humanNotice !== undefined && <p className={css.uatNotice} role="status">✓ {humanNotice}</p>}
        </section>
      )}
    </section>
  )
}

function ContenderPanel({
  contender,
  winner,
  promoted,
  canControl,
  canPreview,
  busy,
  sharedError,
  onPreview,
  runId,
  loadCandidatePreview,
  startCandidatePreview,
  stopCandidatePreview,
  recordHumanEvaluation,
  onRunUpdate,
  t,
}: {
  contender: ArenaContenderState
  winner: boolean
  promoted: boolean
  canControl: boolean
  canPreview: boolean
  busy: boolean
  sharedError?: string
  onPreview: () => void
  runId: string
  loadCandidatePreview: ArenaCardFace['loadCandidatePreview']
  startCandidatePreview: ArenaCardFace['startCandidatePreview']
  stopCandidatePreview: ArenaCardFace['stopCandidatePreview']
  recordHumanEvaluation: ArenaCardFace['recordHumanEvaluation']
  onRunUpdate: (run: ArenaRunState) => void
  t: ArenaCardProps['t']
}) {
  const evidence = contender.evidence
  const findings = [
    ...evidence?.securityFindings ?? [],
    ...contender.reviews.flatMap(review => review.findings),
  ]
  return (
    <article className={css.contender} data-status={contender.status} data-winner={winner || undefined}>
      <header className={css.contenderHead}>
        <div className={css.contenderIdentity}>
          <span className={css.contenderLabel}>{contender.label}</span>
          <span className={css.route}>{contender.provider} / {contender.model}</span>
          <span className={css.credentials}>{t('credentialRefs')}: {contender.credentialRefs.join(', ') || '—'}</span>
        </div>
        <span className={css.statusPill} data-status={contender.status}>{t(statusKey(contender.status))}</span>
      </header>

      {(winner || promoted) && (
        <div className={css.badges}>
          {winner && <span className={css.winnerBadge}>{t('winner')}</span>}
          {promoted && <span className={css.promotedBadge}>{t('promoted')}</span>}
        </div>
      )}

      <div className={css.metrics}>
        <span>{t('metric.duration')} {formatDuration(contenderDuration(contender))}</span>
        <span>{t('metric.tokens')} {formatTokens(contender.progress.usage.totalTokens)}</span>
        <span>{t('metric.calls')} {contender.progress.modelCalls}</span>
        <span>{t('metric.tools')} {contender.progress.toolCalls}</span>
        <span>{t('metric.files')} {evidence?.changedFiles.length ?? 0}</span>
        <span>+{evidence?.addedLines ?? 0} / −{evidence?.deletedLines ?? 0}</span>
      </div>

      <StageRail contender={contender} t={t} />

      {evidence !== undefined && evidence.decision.status !== 'approved' && (
        <div className={css.decisionReasons}>
          <strong>{t(evidence.decision.status === 'unavailable' ? 'decision.unavailable' : 'decision.rejected')}</strong>
          <ul>{evidence.decision.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
      {contender.error !== undefined && contender.error !== sharedError && <div className={css.inlineError}>{contender.error}</div>}

      <section className={css.section}>
        <h4>{t('reviews')}</h4>
        {contender.reviews.length === 0
          ? <p className={css.empty}>{t('empty')}</p>
          : <div className={css.reviewList}>{contender.reviews.map(review => <ReviewNode key={review.id} review={review} t={t} />)}</div>}
      </section>

      <section className={css.section}>
        <h4>{t('security')}</h4>
        <Findings findings={findings} t={t} />
      </section>

      <details className={css.disclosure} open={evidence?.passed === false || undefined}>
        <summary>{t('checks')} <span>{evidence?.checks.length ?? 0}</span></summary>
        {evidence === undefined || evidence.checks.length === 0
          ? <p className={css.empty}>{t('empty')}</p>
          : <ul className={css.checkList}>
            {evidence.checks.map((check) => {
              const detail = checkDetail(check)
              return (
                <li key={check.id} className={css.check} data-status={check.status}>
                  <div className={css.checkRow}>
                    <span className={css.checkDot} aria-hidden />
                    <span className={css.checkStage}>{t(stageKey(check.stage))}</span>
                    <span className={css.checkLabel}>{check.label}</span>
                    <span className={css.checkMeta}>{check.required ? t('required') : t('optional')} · {formatDuration(check.durationMs)}</span>
                  </div>
                  {check.sandbox !== undefined && (
                    <div className={css.sandboxFact}>{t('sandbox.file')}: {check.sandbox.enforcement}; {t('sandbox.network')}: {t('no')}</div>
                  )}
                  {detail.length > 0 && (
                    <details className={css.checkOutput}>
                      <summary>{t('output')}</summary>
                      <pre>{detail}</pre>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>}
      </details>

      <details className={css.disclosure}>
        <summary>{t('response')}</summary>
        <pre className={css.prose}>{contender.finalResponse ?? t('empty')}</pre>
      </details>

      <CandidatePreviewPanel
        runId={runId}
        contender={contender}
        canControl={canPreview}
        loadCandidatePreview={loadCandidatePreview}
        startCandidatePreview={startCandidatePreview}
        stopCandidatePreview={stopCandidatePreview}
        recordHumanEvaluation={recordHumanEvaluation}
        onRunUpdate={onRunUpdate}
        t={t}
      />

      <details className={css.disclosure}>
        <summary>{t('activity')} <span>{contender.progress.activity.length}</span></summary>
        {contender.progress.activity.length === 0
          ? <p className={css.empty}>{t('empty')}</p>
          : <ol className={css.activityList}>
            {contender.progress.activity.slice(-12).map((activity, index) => (
              <li key={`${activity.time}-${index}`}>
                <time>{new Date(activity.time).toLocaleTimeString()}</time>
                <code>{activity.kind}</code>
                <span>{activity.detail}</span>
              </li>
            ))}
          </ol>}
      </details>

      {evidence?.decision.status === 'approved' && !promoted && (
        <button type="button" className={css.promoteButton} disabled={!canControl || busy} onClick={onPreview}>
          {t('action.preview')}
        </button>
      )}
    </article>
  )
}

/** Standalone Arena setup or run detail. No Client Context enters the component. */
export const ArenaCard = memo(function ArenaCard({
  view,
  targetId,
  isLoopback,
  loadRun,
  loadReport,
  loadFileDiff,
  loadCandidatePreview,
  startCandidatePreview,
  stopCandidatePreview,
  recordHumanEvaluation,
  setCredential,
  loadSetup,
  writePolicy,
  cancel,
  cleanup,
  preview: requestPreview,
  confirm,
  t,
}: ArenaCardProps) {
  const showsSetup = view === 'setup'
  const [run, setRun] = useState<ArenaRunState>()
  const [setup, setSetup] = useState<ArenaSetupReport>()
  const [policyText, setPolicyText] = useState('')
  const [setupError, setSetupError] = useState<string>()
  const [setupNotice, setSetupNotice] = useState<string>()
  const [setupBusy, setSetupBusy] = useState(false)
  const [credentialBusy, setCredentialBusy] = useState<string>()
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({})
  const [readError, setReadError] = useState<string>()
  const [controlError, setControlError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [promotion, setPromotion] = useState<ArenaPromotionPreview>()
  const [acknowledged, setAcknowledged] = useState(false)

  const refresh = useCallback(async (): Promise<number> => {
    const response = await loadRun(targetId)
    setRun(response.run)
    setReadError(undefined)
    return response.pollAfterMs
  }, [loadRun, targetId])

  const refreshSetup = useCallback(async (): Promise<void> => {
    const report = await loadSetup(targetId)
    setSetup(report)
    setPolicyText(report.policyText)
    setSetupError(undefined)
  }, [loadSetup, targetId])

  useEffect(() => {
    if (!showsSetup) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      try {
        const report = await loadSetup(targetId)
        if (stopped) return
        setSetup(report)
        setPolicyText(report.policyText)
        setSetupError(undefined)
      } catch (error) {
        if (stopped) return
        setSetupError(error instanceof Error ? error.message : String(error))
      }
    }
    void read()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [loadSetup, showsSetup, targetId])

  useEffect(() => {
    if (showsSetup) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      try {
        const pollAfterMs = await refresh()
        if (!stopped) timer = setTimeout(() => { void read() }, pollAfterMs)
      } catch (error) {
        if (stopped) return
        setReadError(error instanceof Error ? error.message : String(error))
        timer = setTimeout(() => { void read() }, 1_000)
      }
    }
    void read()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [refresh, showsSetup])

  const act = useCallback(async (
    label: string,
    action: () => Promise<ArenaRunState>,
    successNotice?: string,
  ): Promise<boolean> => {
    setBusy(label)
    setControlError(undefined)
    setNotice(undefined)
    try {
      setRun(await action())
      if (successNotice !== undefined) setNotice(successNotice)
      return true
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setBusy(undefined)
    }
  }, [])

  const requestPromotion = useCallback(async (contenderId: string): Promise<void> => {
    if (run === undefined) return
    setBusy(`preview:${contenderId}`)
    setControlError(undefined)
    setNotice(undefined)
    try {
      setPromotion(await requestPreview(run.runId, contenderId))
      setAcknowledged(false)
      setNotice(t('notice.preview'))
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }, [requestPreview, run, t])

  const confirmPromotion = useCallback(async (): Promise<void> => {
    if (promotion === undefined || !acknowledged) return
    const succeeded = await act('confirm', async () => (await confirm(promotion.token)).run, t('notice.promoted'))
    if (succeeded) {
      setPromotion(undefined)
      setAcknowledged(false)
    }
  }, [acknowledged, act, confirm, promotion, t])

  const savePolicy = useCallback(async (): Promise<void> => {
    setSetupBusy(true)
    setSetupError(undefined)
    setSetupNotice(undefined)
    try {
      const report = await writePolicy(targetId, policyText)
      setSetup(report)
      setPolicyText(report.policyText)
      setSetupNotice(t('setup.saved'))
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error))
    } finally {
      setSetupBusy(false)
    }
  }, [policyText, t, targetId, writePolicy])

  const saveCredential = useCallback(async (ref: string): Promise<void> => {
    const value = credentialDrafts[ref]?.trim() ?? ''
    if (value.length === 0) return
    setCredentialBusy(ref)
    setSetupError(undefined)
    setSetupNotice(undefined)
    try {
      await setCredential(ref, value)
      setCredentialDrafts(current => ({ ...current, [ref]: '' }))
      await refreshSetup()
      setSetupNotice(t('setup.credentialSaved'))
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error))
    } finally {
      setCredentialBusy(undefined)
    }
  }, [credentialDrafts, refreshSetup, setCredential, t])

  const downloadReport = useCallback(async (): Promise<void> => {
    if (run === undefined) return
    setBusy('report')
    setControlError(undefined)
    setNotice(undefined)
    try {
      const report = await loadReport(run.runId)
      const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `evidence-arena-${run.runId.replace(/[^A-Za-z0-9._-]/gu, '_')}.json`
        anchor.style.display = 'none'
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
      } finally {
        URL.revokeObjectURL(url)
      }
      setNotice(t('notice.reportDownloaded'))
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }, [loadReport, run, t])

  const terminal = run !== undefined && !isActiveArenaStatus(run.status)
  const active = run !== undefined && isActiveArenaStatus(run.status)
  const winner = run?.winner?.contenderId
  const orderedContenders = useMemo(() => run?.contenders ?? [], [run])

  if (showsSetup) {
    if (setup === undefined) {
      return (
        <div className={css.loadingCard} data-error={setupError !== undefined || undefined}>
          <div className={css.brandMark}>A/B</div>
          <div><strong>{t('setup.title')}</strong><p>{setupError ?? t('setup.loading')}</p></div>
          {setupError !== undefined && <button type="button" onClick={() => { void refreshSetup() }}>{t('action.retryRead')}</button>}
        </div>
      )
    }
    const report = setup.preflight
    const missingCredentials = report.credentials.filter(item => !item.configured)
    const remainingRemediations = report.remediations.filter(item => item.action !== 'configure-credential')
    return (
      <div className={css.setupRoot} data-ready={report.ready || undefined}>
        <header className={css.setupHeader}>
          <div className={css.brandMark}>A/B</div>
          <div>
            <h3>{t('setup.title')}</h3>
            <p>{t('setup.subtitle')}</p>
          </div>
          <span className={css.setupStatus} data-ready={report.ready || undefined}>
            {report.ready ? t('setup.ready') : t('setup.blocked')}
          </span>
        </header>
        {!isLoopback && <div className={css.notice}>{t('remoteReadOnly')}</div>}
        {setupNotice !== undefined && <div className={css.successBanner} role="status">✓ {setupNotice}</div>}
        {setupError !== undefined && <div className={css.errorBanner} role="alert">{setupError}</div>}

        <section className={css.setupSummary}>
          <div><span>{t('setup.repository')}</span><code>{setup.repoRoot ?? '—'}</code></div>
          <div><span>{t('setup.policy')}</span><code>{setup.policyPath ?? t('setup.hostFallback')}</code></div>
          <div><span>{t('setup.revision')}</span><strong>{report.policy.policyId}@{report.policy.revision}</strong></div>
          <div><span>{t('setup.signature')}</span><strong>{report.policy.signature.status}</strong></div>
          <div><span>{t('setup.tokenLimit')}</span><strong>{report.budget.limits.totalTokens === 0 ? t('budget.unlimited') : formatTokens(report.budget.limits.totalTokens)}</strong></div>
          <div><span>{t('setup.callLimit')}</span><strong>{report.budget.limits.modelCalls === 0 ? t('budget.unlimited') : report.budget.limits.modelCalls}</strong></div>
          <div><span>{t('setup.timeLimit')}</span><strong>{formatDuration(report.budget.limits.wallTimeMs)}</strong></div>
        </section>

        <section className={css.credentialPanel} aria-label={t('setup.credentials')}>
          <header>
            <div><h4>{t('setup.credentials')}</h4><p>{t('setup.credentialsHelp')}</p></div>
            <span data-ready={missingCredentials.length === 0 || undefined}>
              {missingCredentials.length === 0 ? t('setup.credentialsReady') : t('setup.credentialsMissing')}
            </span>
          </header>
          {missingCredentials.length === 0
            ? <p className={css.credentialReady}>✓ {t('setup.credentialsReadyHelp')}</p>
            : <div className={css.credentialList}>{missingCredentials.map(item => (
                <form key={item.ref} className={css.credentialRow} onSubmit={(event) => { event.preventDefault(); void saveCredential(item.ref) }}>
                  <div><strong>{item.ref}</strong><small>{item.consumers.join(' · ')}</small></div>
                  <input
                    type="password"
                    autoComplete="off"
                    aria-label={`${t('setup.credentialValue')} ${item.ref}`}
                    placeholder={t('setup.credentialPlaceholder')}
                    value={credentialDrafts[item.ref] ?? ''}
                    disabled={!isLoopback || !item.writable || credentialBusy !== undefined}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setCredentialDrafts(current => ({ ...current, [item.ref]: value }))
                    }}
                  />
                  <button type="submit" disabled={!isLoopback || !item.writable || credentialBusy !== undefined || (credentialDrafts[item.ref]?.trim().length ?? 0) === 0}>
                    {credentialBusy === item.ref ? t('setup.credentialSaving') : t('setup.credentialSave')}
                  </button>
                  {!item.writable && <p className={css.credentialReadOnly}>{t('setup.credentialReadOnly')}</p>}
                </form>
              ))}</div>}
          <small className={css.credentialPrivacy}>{t('setup.credentialPrivacy')}</small>
        </section>

        <section className={css.setupHealth} aria-label={t('setup.overview')}>
          <div className={css.diagnosticCounts}>
            <div data-kind="blocker"><strong>{report.blockers.length}</strong><span>{t('setup.blockers')}</span></div>
            <div data-kind="warning"><strong>{report.warnings.length}</strong><span>{t('setup.warnings')}</span></div>
            <div data-kind="repair"><strong>{report.remediations.length}</strong><span>{t('setup.repairs')}</span></div>
          </div>
          {report.blockers.length > 0 && (
            <details className={css.setupDisclosure} data-kind="blocker" open>
              <summary><span>{t('setup.blockers')}</span><span>{report.blockers.length}</span></summary>
              <div className={css.diagnosticGrid}>
                {report.blockers.map(message => <div key={message} className={css.blocker}>● {message}</div>)}
              </div>
            </details>
          )}
          {report.warnings.length > 0 && (
            <details className={css.setupDisclosure} data-kind="warning">
              <summary><span>{t('setup.warnings')}</span><span>{report.warnings.length}</span></summary>
              <div className={css.diagnosticGrid}>
                {report.warnings.map(message => <div key={message} className={css.warning}>△ {message}</div>)}
              </div>
            </details>
          )}
        </section>

        <details className={css.setupDisclosure}>
          <summary><span>{t('setup.routes')}</span><span>{report.routes.length}</span></summary>
          <div className={css.routeGrid}>{report.routes.map(route => (
            <article key={`${route.role}-${route.id}`}>
              <strong>{route.role}: {route.id}</strong>
              <code>{route.provider} / {route.model}</code>
              <small>{['organization', 'gateway', 'modelFamily'].map(key => `${key}=${route.identity[key as keyof typeof route.identity] ?? '?'}`).join(' · ')}</small>
            </article>
          ))}</div>
        </details>

        <details className={css.setupDisclosure} open={report.blockers.length > 0 || undefined}>
          <summary><span>{t('setup.repairs')}</span><span>{remainingRemediations.length}</span></summary>
          {remainingRemediations.length === 0
            ? <p className={css.empty}>{t('setup.noRepairs')}</p>
            : <ol className={css.remediationList}>{remainingRemediations.map(item => (
              <li key={item.id} data-severity={item.severity}>
                <strong>{item.title}</strong><p>{item.detail}</p>
              </li>
            ))}</ol>}
        </details>

        <details className={`${css.setupDisclosure} ${css.policyDisclosure}`}>
          <summary><span>{t('setup.editor')}</span><span>{t('setup.editorCollapsed')}</span></summary>
          <section className={css.policyEditor}>
            <p>{t('setup.editorHelp')}</p>
            <textarea
              value={policyText}
              spellCheck={false}
              onChange={(event) => { setPolicyText(event.currentTarget.value); setSetupNotice(undefined) }}
            />
            <div className={css.policyActions}>
              <span>{t('setup.noSecrets')}</span>
              <button type="button" className={css.primaryButton} disabled={!isLoopback || !setup.canWritePolicy || setupBusy} onClick={() => { void savePolicy() }}>
                {setupBusy ? t('setup.saving') : t('setup.save')}
              </button>
            </div>
          </section>
        </details>
      </div>
    )
  }

  if (run === undefined) {
    return (
      <div className={css.loadingCard} data-error={readError !== undefined || undefined}>
        <div className={css.brandMark}>A/B</div>
        <div><strong>{t('title')}</strong><p>{readError ?? t('loading')}</p></div>
        {readError !== undefined && (
          <button type="button" onClick={() => { void refresh() }}>{t('action.retryRead')}</button>
        )}
      </div>
    )
  }

  const approvedCount = run.contenders.filter(contender => contender.evidence?.decision.status === 'approved').length
  return (
    <div className={css.root} data-status={run.status}>
      <header className={css.hero}>
        <div className={css.brandMark}>A/B</div>
        <div className={css.heroText}>
          <div className={css.titleRow}>
            <h3>{t('title')}</h3>
            <span className={css.runStatus} data-status={run.status}>{t(statusKey(run.status))}</span>
          </div>
          <p className={css.subtitle}>{t('subtitle')}</p>
          <p className={css.task}>{run.task}</p>
          <div className={css.metadata}>
            <span>{t('runId')}: <code>{run.runId}</code></span>
            <span>{t('base')}: <code>{shortCommit(run.baseCommit)}</code></span>
          </div>
        </div>
        <div className={css.heroActions}>
          {active && <button type="button" className={css.secondaryButton} disabled={!isLoopback || busy !== undefined} onClick={() => { void act('cancel', async () => (await cancel(run.runId)).run, t('notice.cancelled')) }}>{t('action.cancel')}</button>}
          {terminal && <button type="button" className={css.secondaryButton} disabled={busy !== undefined} onClick={() => { void downloadReport() }}>{busy === 'report' ? t('action.downloadingReport') : t('action.downloadReport')}</button>}
          {terminal && <button type="button" className={css.secondaryButton} disabled={!isLoopback || busy !== undefined || run.contenders.every(contender => contender.cleanedAt !== undefined)} onClick={() => { void act('cleanup', async () => (await cleanup(run.runId)).run, t('notice.cleaned')) }}>{t('action.cleanup')}</button>}
        </div>
      </header>

      {!isLoopback && <div className={css.notice}>{t('remoteReadOnly')}</div>}
      <div className={css.limits}>{t('sandbox.limit')}</div>
      {notice !== undefined && <div className={css.successBanner} role="status" aria-live="polite">✓ {notice}</div>}
      {controlError !== undefined && <div className={css.errorBanner} role="alert"><strong>{t('error')}:</strong> {controlError}</div>}
      {controlError === undefined && run.error !== undefined && (
        <div className={run.status === 'completed' ? css.auditBanner : css.errorBanner} role={run.status === 'completed' ? 'status' : 'alert'}>
          <strong>{t(run.status === 'completed' ? 'auditNotice' : 'error')}:</strong> {run.error}
        </div>
      )}

      <section className={css.overview}>
        <div><span>{t('overview.approved')}</span><strong>{approvedCount}/{run.contenders.length}</strong></div>
        <div><span>{t('overview.duration')}</span><strong>{formatDuration(run.budget.consumed.wallTimeMs)} / {formatDuration(run.budget.limits.wallTimeMs)}</strong></div>
        <div><span>{t('overview.tokens')}</span><strong>{formatTokens(run.budget.consumed.totalTokens)} / {run.budget.limits.totalTokens === 0 ? t('budget.unlimited') : formatTokens(run.budget.limits.totalTokens)}</strong></div>
        <div><span>{t('overview.calls')}</span><strong>{run.budget.consumed.modelCalls} / {run.budget.limits.modelCalls === 0 ? t('budget.unlimited') : run.budget.limits.modelCalls}</strong></div>
        <div><span>{t('overview.nodes')}</span><strong>{run.metrics === undefined ? '—' : run.metrics.builders + run.metrics.reviewers + run.metrics.gateNodes}</strong></div>
      </section>

      <section className={css.leader} data-empty={winner === undefined || undefined}>
        <span>{winner === undefined ? t('noWinner') : t('winner')}</span>
        {winner !== undefined && <strong>{winner}</strong>}
        {run.winner !== undefined && <p>{run.winner.reason}</p>}
      </section>

      <ComparisonSummary contenders={orderedContenders} winnerId={winner} t={t} />

      <ArenaDiffReview
        runId={run.runId}
        contenders={orderedContenders}
        winnerId={winner}
        loadFileDiff={loadFileDiff}
        t={t}
      />

      <div className={css.grid} data-count={orderedContenders.length}>
        {orderedContenders.map(contender => (
          <ContenderPanel
            key={contender.id}
            contender={contender}
            winner={winner === contender.id}
            promoted={run.promotion?.contenderId === contender.id}
            canControl={isLoopback && run.status === 'completed' && run.promotion === undefined}
            canPreview={isLoopback && terminal}
            busy={busy !== undefined}
            {...run.error === undefined ? {} : { sharedError: run.error }}
            onPreview={() => { void requestPromotion(contender.id) }}
            runId={run.runId}
            loadCandidatePreview={loadCandidatePreview}
            startCandidatePreview={startCandidatePreview}
            stopCandidatePreview={stopCandidatePreview}
            recordHumanEvaluation={recordHumanEvaluation}
            onRunUpdate={setRun}
            t={t}
          />
        ))}
      </div>

      {promotion !== undefined && (
        <section className={css.confirmation} aria-label={t('preview.title')}>
          <div className={css.confirmBody}>
            <h4>{t('preview.title')}: {promotion.contenderId}</h4>
            <p>{t('preview.warning')}</p>
            <dl>
              <dt>{t('preview.hash')}</dt><dd><code>{promotion.patchHash}</code></dd>
              <dt>{t('preview.gates')}</dt><dd>{promotion.checks.filter(check => check.required && check.status === 'passed').length}/{promotion.checks.filter(check => check.required).length}</dd>
              <dt>{t('preview.findings')}</dt><dd>{promotion.securityFindings.length}</dd>
              <dt>{t('preview.expires')}</dt><dd>{new Date(promotion.expiresAt).toLocaleString()}</dd>
            </dl>
            <label className={css.acknowledgement}>
              <input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.currentTarget.checked) }} />
              <span>{t('preview.acknowledge')}</span>
            </label>
          </div>
          <div className={css.confirmActions}>
            <button type="button" className={css.secondaryButton} disabled={busy !== undefined} onClick={() => { setPromotion(undefined); setAcknowledged(false); setNotice(undefined) }}>{t('action.dismiss')}</button>
            <button type="button" className={css.primaryButton} disabled={busy !== undefined || !acknowledged} onClick={() => { void confirmPromotion() }}>{busy === 'confirm' ? t('action.promoting') : t('action.confirm')}</button>
          </div>
        </section>
      )}
    </div>
  )
})
