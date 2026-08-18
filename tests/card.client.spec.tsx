// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ArenaCard, type ArenaCardProps } from '../src/client/ArenaCard.tsx'
import { en } from '../src/client/locales.ts'
import {
  ARENA_REPORT_VERSION,
  ARENA_STATE_VERSION,
  type ArenaCandidateFileDiff,
  type ArenaCandidatePreview,
  type ArenaPortableReport,
  type ArenaPromotionPreview,
  type ArenaRunState,
  type ArenaSetupReport,
} from '../src/types.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function runState(overrides: Partial<ArenaRunState> = {}): ArenaRunState {
  const now = Date.now()
  const usage = { inputTokens: 120, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 20, totalTokens: 160 }
  const checks = [{
    id: 'tests',
    label: 'Focused tests',
    stage: 'test' as const,
    kind: 'command' as const,
    required: true,
    argv: ['npm', 'test'],
    status: 'passed' as const,
    exitCode: 0,
    signal: null,
    timedOut: false,
    startedAt: now - 200,
    finishedAt: now - 80,
    durationMs: 120,
    stdout: '3 tests passed',
    stderr: '',
    outputTruncated: false,
  }]
  const evidence = {
    passed: true,
    patchHash: 'a'.repeat(64),
    patchBytes: 128,
    untrackedBytes: 0,
    changedFiles: [{
      path: 'src/answer.ts', status: 'M', added: 2, deleted: 1, binary: false, untracked: false,
    }],
    addedLines: 2,
    deletedLines: 1,
    diffPreview: '+export const answer = 42\n',
    diffPreviewTruncated: false,
    checks,
    securityFindings: [],
    decision: {
      status: 'approved' as const,
      decidedAt: now,
      reasons: [],
      stages: (['integrity', 'quality', 'test', 'logic', 'security'] as const).map(stage => ({
        stage,
        status: 'approved' as const,
        requiredNodes: 1,
        passedNodes: 1,
      })),
    },
  }
  return {
    version: ARENA_STATE_VERSION,
    runId: 'arena-fixture',
    workspaceId: 'workspace-fixture',
    task: 'Implement a verified answer',
    repoRoot: '/fixture/repo',
    baseCommit: 'b'.repeat(40),
    status: 'completed',
    revision: 10,
    createdAt: now - 1_000,
    updatedAt: now,
    policy: {
      source: 'host-config', policyId: 'fixture', revision: '1', digest: 'c'.repeat(64),
      signature: { status: 'ignored' },
      rules: {
        judgeCommands: [], requireChanges: true, requireProjectTests: false,
        requireLogicReview: false, requireSecurityReview: false, allowBinaryFiles: false,
        maxChangedFiles: 20, maxReviewInputChars: 20_000, protectedPathPatterns: [], sharedContextPaths: [],
      },
    },
    budget: {
      limits: { totalTokens: 0, modelCalls: 0, wallTimeMs: 60_000 },
      consumed: { totalTokens: 320, modelCalls: 2, wallTimeMs: 1_000 },
      status: 'within-budget', stopAfterApproved: 0, stoppedContenders: [],
    },
    winner: {
      contenderId: 'evidence',
      reason: 'Passed every configured gate.',
      tieBreak: ['changed-lines=3'],
    },
    contenders: [
      {
        id: 'direct', label: 'Direct Builder', provider: 'deepseek', model: 'direct', identity: {}, credentialRefs: ['DEEPSEEK_API_KEY'], status: 'passed',
        worktreePath: '/fixture/direct', childSessionId: 'direct-session',
        checkpoint: 'decision-complete', attempts: 1,
        startedAt: now - 900, builderDurationMs: 300, finishedAt: now - 100,
        progress: { notifications: 4, events: 3, toolCalls: 1, modelCalls: 1, usage, activity: [] },
        reviews: [],
        finalResponse: 'Direct result', evidence,
      },
      {
        id: 'evidence', label: 'Evidence Builder', provider: 'deepseek', model: 'evidence', identity: {}, credentialRefs: ['DEEPSEEK_API_KEY'], status: 'passed',
        worktreePath: '/fixture/evidence', childSessionId: 'evidence-session',
        checkpoint: 'decision-complete', attempts: 1,
        startedAt: now - 1_000, builderDurationMs: 400, finishedAt: now,
        progress: {
          notifications: 8,
          events: 6,
          toolCalls: 2,
          modelCalls: 1,
          usage,
          activity: [{ time: now, kind: 'tool/call', detail: 'bash' }],
        },
        reviews: [],
        finalResponse: 'Evidence-backed result', evidence,
      },
    ],
    ...overrides,
  }
}

function setupReport(): ArenaSetupReport {
  const policyText = '{\n  "schemaVersion": 1\n}\n'
  return {
    workspaceId: 'workspace-fixture', repoRoot: '/fixture/repo',
    policyPath: '.dsh/arena-policy.json', policyText, canWritePolicy: true,
    preflight: {
      ready: false, checkedAt: Date.now(),
      blockers: ['A required project test command is missing.'], warnings: ['Network is not isolated.'],
      routes: [{
        id: 'direct', role: 'builder', provider: 'fixture', model: 'fixture-model',
        credentialRefs: ['FIXTURE_API_KEY'],
        identity: { organization: 'fixture-org', gateway: 'fixture-gateway', modelFamily: 'fixture-family' },
      }],
      credentials: [{ ref: 'FIXTURE_API_KEY', configured: true, writable: false, consumers: ['builder:direct'] }],
      reviewCorrelations: [],
      budget: {
        limits: { totalTokens: 400_000, modelCalls: 48, wallTimeMs: 1_200_000 },
        stopAfterApproved: 0, unlimited: [], requiresAcknowledgement: false,
      },
      policy: {
        source: 'host-config', policyId: 'host-config', revision: 'runtime', digest: 'd'.repeat(64),
        signature: { status: 'ignored' },
        rules: {
          judgeCommands: [], requireChanges: true, requireProjectTests: true,
          requireLogicReview: false, requireSecurityReview: false, allowBinaryFiles: false,
          maxChangedFiles: 20, maxReviewInputChars: 20_000, protectedPathPatterns: [], sharedContextPaths: [],
        },
      },
      remediations: [{
        id: 'project-test-command', severity: 'blocker', title: 'Add a required project test command',
        detail: 'Edit the policy template.', action: 'write-policy-pack',
      }],
      gates: {
        requireProjectTests: true, requireLogicReview: false, requireSecurityReview: false,
        reviewerIndependence: 'warn', requireFullSandbox: true, revalidateOnPromotion: true, commands: [],
      },
      isolation: { fileEffects: 'harness-sandbox', networkIsolated: false, hostReadsIsolated: false },
    },
  }
}

function candidateFileDiff(contenderId = 'evidence'): ArenaCandidateFileDiff {
  return {
    runId: 'arena-fixture',
    contenderId,
    patchHash: 'a'.repeat(64),
    file: { path: 'src/answer.ts', status: 'M', added: 2, deleted: 1, binary: false, untracked: false },
    diff: [
      'diff --git a/src/answer.ts b/src/answer.ts',
      '--- a/src/answer.ts',
      '+++ b/src/answer.ts',
      '@@ -1,2 +1,3 @@',
      '-export const answer = 41',
      '+export const answer = 42',
      '+export const verified = true',
      ' export default answer',
      '',
    ].join('\n'),
    totalChars: 247,
    truncated: false,
  }
}

function portableReport(run: ArenaRunState): ArenaPortableReport {
  return {
    schemaVersion: ARENA_REPORT_VERSION,
    generatedAt: Date.now(),
    runId: run.runId,
    task: run.task,
    baseCommit: run.baseCommit,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    policy: {
      source: run.policy.source,
      policyId: run.policy.policyId,
      revision: run.policy.revision,
      digest: run.policy.digest,
      signature: { ...run.policy.signature },
    },
    budget: structuredClone(run.budget),
    contenders: [],
    privacy: {
      redactionsApplied: 0,
      truncationsApplied: 0,
      reviewBeforeSharing: true,
      omitted: ['raw evidence'],
    },
    limitations: ['One task is not model accuracy.'],
  }
}

function props(overrides: Partial<ArenaCardProps> = {}): ArenaCardProps {
  const run = runState()
  const previewStates = new Map<string, ArenaCandidatePreview['status']>()
  const candidatePreview = (contenderId: string, status: ArenaCandidatePreview['status']): ArenaCandidatePreview => ({
    runId: run.runId,
    contenderId,
    artifactHash: 'a'.repeat(64),
    status,
    ...(status === 'running' ? {
      launch: { kind: 'static-output' as const, label: 'dist/index.html', argv: ['node', '<arena-static-server>'] },
      url: 'http://127.0.0.1:43123/', pid: 123, readyAt: Date.now(),
    } : {}),
    stdout: status === 'running' ? 'ARENA_PREVIEW_READY' : '',
    stderr: '',
    outputTruncated: false,
    safety: {
      explicitStartRequired: true, disposableWorktree: true, loopbackRequested: true,
      networkIsolated: false, hostReadsIsolated: false,
    },
  })
  return {
    view: 'run',
    targetId: 'arena-fixture',
    isLoopback: true,
    addWorkspace: vi.fn(async () => ({ workspaceId: 'workspace-fixture' })),
    createDemoWorkspace: vi.fn(async () => ({
      workspaceId: 'workspace-demo', path: '/fixture/demo', template: 'commonjs-sum' as const,
      createdAt: Date.now(), suggestedTask: 'Fix the demo.',
    })),
    setCredential: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    start: vi.fn(async () => ({ run, pollAfterMs: 60_000 })),
    retry: vi.fn(async () => ({ run, pollAfterMs: 60_000 })),
    loadRun: vi.fn(async () => ({ run, pollAfterMs: 60_000 })),
    loadReport: vi.fn(async () => portableReport(run)),
    loadFileDiff: vi.fn(async (_runId: string, contenderId: string) => candidateFileDiff(contenderId)),
    loadCandidatePreview: vi.fn(async (_runId: string, contenderId: string) => candidatePreview(contenderId, previewStates.get(contenderId) ?? 'idle')),
    startCandidatePreview: vi.fn(async (_runId: string, contenderId: string) => {
      previewStates.set(contenderId, 'running')
      return candidatePreview(contenderId, 'running')
    }),
    stopCandidatePreview: vi.fn(async (_runId: string, contenderId: string) => {
      previewStates.set(contenderId, 'stopped')
      return candidatePreview(contenderId, 'stopped')
    }),
    recordHumanEvaluation: vi.fn(async (_runId: string, contenderId: string, verdict: 'passed' | 'failed' | 'inconclusive', note?: string) => {
      const next = structuredClone(run)
      const contender = next.contenders.find(item => item.id === contenderId)!
      contender.humanEvaluation = {
        artifactHash: contender.evidence!.patchHash,
        verdict,
        ...note === undefined ? {} : { note },
        recordedAt: Date.now(),
        previewReadyAt: Date.now(),
        source: 'loopback-user-attestation',
      }
      return { run: next, pollAfterMs: 60_000 }
    }),
    loadSetup: vi.fn(async () => setupReport()),
    writePolicy: vi.fn(async () => ({ ...setupReport(), preflight: { ...setupReport().preflight, ready: true, blockers: [] } })),
    cancel: vi.fn(async () => ({ run: runState({ status: 'cancelled' }), pollAfterMs: 60_000 })),
    cleanup: vi.fn(async () => ({ run, pollAfterMs: 60_000 })),
    preview: vi.fn(async (_runId: string, contenderId: string): Promise<ArenaPromotionPreview> => ({
      token: 'preview-token',
      runId: run.runId,
      contenderId,
      repoRoot: run.repoRoot,
      baseCommit: run.baseCommit,
      patchHash: 'a'.repeat(64),
      expiresAt: Date.now() + 30_000,
      changedFiles: run.contenders[0]?.evidence?.changedFiles ?? [],
      checks: run.contenders[0]?.evidence?.checks ?? [],
      decision: run.contenders[0]!.evidence!.decision,
      securityFindings: [],
    })),
    confirm: vi.fn(async () => ({
      run: runState({
        promotion: {
          contenderId: 'evidence',
          patchHash: 'a'.repeat(64),
          promotedAt: Date.now(),
          changedFiles: ['src/answer.ts'],
          verification: ['required-deterministic-gates-revalidated'],
        },
      }),
      pollAfterMs: 60_000,
    })),
    t: key => key in en ? en[key as keyof typeof en] : key,
    ...overrides,
  } as ArenaCardProps
}

describe('ArenaCard', () => {
  it('renders a completed comparison and performs the two-step promotion flow', async () => {
    const card = props()
    render(<ArenaCard {...card} />)

    expect(await screen.findByText('Implement a verified answer')).toBeTruthy()
    expect(screen.getAllByText('Direct Builder')).toHaveLength(3)
    expect(screen.getAllByText('Evidence Builder')).toHaveLength(3)
    expect(screen.getAllByText('Mechanical leader (ranking only)')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Comparison summary' })).toBeTruthy()
    expect(screen.getByText('Fastest')).toBeTruthy()
    expect(screen.getAllByText('Lowest token use')).toHaveLength(2)
    expect(screen.getAllByText('Smallest change')).toHaveLength(2)
    expect(screen.getByText(/It is not cross-task model accuracy/iu)).toBeTruthy()
    const previewButtons = screen.getAllByRole('button', { name: 'Prepare promotion' })
    fireEvent.click(previewButtons[1]!)

    expect(await screen.findByText(/promotion confirmation/iu)).toBeTruthy()
    expect(card.preview).toHaveBeenCalledWith('arena-fixture', 'evidence')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Write to original workspace' }))
    await waitFor(() => { expect(card.confirm).toHaveBeenCalledWith('preview-token') })
    expect(await screen.findByText('Written to original workspace')).toBeTruthy()
  })

  it('loads the exact sealed per-file diff from the selected candidate tree', async () => {
    const card = props()
    render(<ArenaCard {...card} />)

    expect(await screen.findByText('Candidate code review')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /answer\.ts/u }))

    expect(await screen.findByText('+export const answer = 42')).toBeTruthy()
    expect(screen.getByText('-export const answer = 41')).toBeTruthy()
    expect(card.loadFileDiff).toHaveBeenCalledWith('arena-fixture', 'evidence', 'src/answer.ts')
  })

  it('downloads a portable JSON report without requiring loopback control authority', async () => {
    const nativeURL = URL
    const createObjectURL = vi.fn(() => 'blob:arena-report')
    const revokeObjectURL = vi.fn()
    class URLWithBlob extends nativeURL {}
    Object.defineProperties(URLWithBlob, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    })
    vi.stubGlobal('URL', URLWithBlob)
    let download = ''
    let href = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download
      href = this.href
    })
    const card = props({ isLoopback: false })
    render(<ArenaCard {...card} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Download evidence report' }))

    await waitFor(() => { expect(card.loadReport).toHaveBeenCalledWith('arena-fixture') })
    expect(download).toBe('evidence-arena-arena-fixture.json')
    expect(href).toBe('blob:arena-report')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('application/json;charset=utf-8')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:arena-report')
    expect(await screen.findByText(/privacy-bounded evaluation report was downloaded/iu)).toBeTruthy()
  })

  it('keeps candidate execution collapsed until explicitly opened, then exposes link, logs, and stop', async () => {
    const card = props()
    render(<ArenaCard {...card} />)
    await screen.findByText('Implement a verified answer')
    expect(card.loadCandidatePreview).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: /Run candidate result/u })[0]!)
    await waitFor(() => { expect(card.loadCandidatePreview).toHaveBeenCalledWith('arena-fixture', 'direct') })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start and test this result' }))

    const link = await screen.findByRole('link', { name: /Open candidate frontend/u })
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:43123/')
    expect(card.startCandidatePreview).toHaveBeenCalledWith('arena-fixture', 'direct')
    fireEvent.change(screen.getByLabelText('Test verdict'), { target: { value: 'passed' } })
    fireEvent.change(screen.getByLabelText('Test note (optional)'), { target: { value: 'Login and save work.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save human verdict' }))
    await waitFor(() => {
      expect(card.recordHumanEvaluation).toHaveBeenCalledWith(
        'arena-fixture', 'direct', 'passed', 'Login and save work.',
      )
    })
    expect(await screen.findAllByText('Human test passed')).toHaveLength(2)
    expect(screen.getAllByText('Login and save work.')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Stop and clean up' }))
    await waitFor(() => { expect(card.stopCandidatePreview).toHaveBeenCalledWith('arena-fixture', 'direct') })
  })

  it('keeps the confirmation visible when promotion fails and disables controls remotely', async () => {
    const failedConfirm = vi.fn(async (): Promise<never> => {
      throw new Error('original HEAD moved')
    })
    const card = props({ isLoopback: false, confirm: failedConfirm })
    const view = render(<ArenaCard {...card} />)
    expect(await screen.findByText('This is not a loopback page. Viewing is allowed; cancel, cleanup, and promotion are disabled.'))
      .toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Prepare promotion' })[0]?.hasAttribute('disabled')).toBe(true)

    view.rerender(<ArenaCard {...card} isLoopback />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Prepare promotion' })[0]!)
    expect(await screen.findByText(/promotion confirmation/iu)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Write to original workspace' }))
    expect(await screen.findByText('original HEAD moved')).toBeTruthy()
    expect(screen.getByText(/promotion confirmation/iu)).toBeTruthy()
  })

  it('loads a rich historical review by its explicit run id', async () => {
    const loadRun = vi.fn(async () => ({ run: runState(), pollAfterMs: 60_000 }))
    render(<ArenaCard {...props({ targetId: 'arena-fixture', loadRun })} />)
    expect(await screen.findByText('Candidate code review')).toBeTruthy()
    expect(loadRun).toHaveBeenCalledWith('arena-fixture')
  })

  it('renders actionable preflight repairs and writes only through the loopback policy action', async () => {
    const card = props({ view: 'setup', targetId: 'workspace-fixture' })
    render(<ArenaCard {...card} />)
    expect(await screen.findByText('Arena setup and preflight')).toBeTruthy()
    expect(screen.getByText(/A required project test command is missing\./u)).toBeTruthy()
    expect(screen.getByText('Add a required project test command')).toBeTruthy()
    const warningSummary = screen.getAllByText('Limits and warnings')
      .find(element => element.closest('summary') !== null)!
    expect(warningSummary.closest('details')?.hasAttribute('open')).toBe(false)
    fireEvent.click(warningSummary)
    expect(screen.getByText(/Network is not isolated\./u)).toBeTruthy()
    fireEvent.click(screen.getByText('Repository Arena Policy Pack'))
    const editor = screen.getByRole('textbox')
    fireEvent.change(editor, { target: { value: '{"schemaVersion":1}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate and save policy' }))
    await waitFor(() => {
      expect(card.writePolicy).toHaveBeenCalledWith('workspace-fixture', '{"schemaVersion":1}')
    })
    expect(await screen.findByText(/The policy was written atomically and preflight was rerun\./u)).toBeTruthy()
  })

  it('writes a missing key through Harness credentials and never keeps the secret in the setup UI', async () => {
    const missing = setupReport()
    missing.preflight.credentials = [{
      ref: 'FIXTURE_API_KEY', configured: false, writable: true, consumers: ['builder:direct'],
    }]
    missing.preflight.blockers = ['credential FIXTURE_API_KEY is not configured']
    missing.preflight.remediations = [{
      id: 'credential:FIXTURE_API_KEY', severity: 'blocker', title: 'Configure FIXTURE_API_KEY',
      detail: 'Use the secure field.', action: 'configure-credential',
    }]
    const ready = setupReport()
    ready.preflight.ready = true
    ready.preflight.blockers = []
    ready.preflight.credentials = [{
      ref: 'FIXTURE_API_KEY', configured: true, writable: true, consumers: ['builder:direct'],
    }]
    ready.preflight.remediations = []
    const loadSetup = vi.fn().mockResolvedValueOnce(missing).mockResolvedValue(ready)
    const setCredential = vi.fn(async () => {})

    render(<ArenaCard {...props({ view: 'setup', targetId: 'workspace-fixture', loadSetup, setCredential })} />)
    const input = await screen.findByLabelText('Credential value FIXTURE_API_KEY')
    fireEvent.change(input, { target: { value: 'test-secret-that-must-disappear' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save securely' }))

    await waitFor(() => {
      expect(setCredential).toHaveBeenCalledWith('FIXTURE_API_KEY', 'test-secret-that-must-disappear')
      expect(loadSetup).toHaveBeenCalledTimes(2)
    })
    expect((await screen.findByRole('status')).textContent)
      .toContain('The credential was written to Harness and preflight was rerun.')
    expect(screen.queryByDisplayValue('test-secret-that-must-disappear')).toBeNull()
    expect(document.body.textContent).not.toContain('test-secret-that-must-disappear')
  })

  it('retries a failed workspace setup read on demand', async () => {
    const loadSetup = vi.fn()
      .mockRejectedValueOnce(new Error('Arena setup report is not indexed yet'))
      .mockResolvedValue(setupReport())
    const pending = props({ view: 'setup', targetId: 'workspace-fixture', loadSetup })
    render(<ArenaCard {...pending} />)
    await waitFor(() => { expect(loadSetup).toHaveBeenCalledTimes(1) })
    expect(await screen.findByText('Arena setup report is not indexed yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }))
    expect(await screen.findByText('Arena setup and preflight')).toBeTruthy()
    expect(loadSetup).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Arena setup report is not indexed yet')).toBeNull()
  })
})
