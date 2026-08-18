/** Validated client port over Arena's trusted-read and loopback-control RPC channels. */

import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  ARENA_REPORT_VERSION,
  ARENA_STATE_VERSION,
  type ArenaCandidateFileDiff,
  type ArenaCandidatePreview,
  type ArenaDemoProject,
  type ArenaPortableReport,
  type ArenaPromotionPreview,
  type ArenaRunResponse,
  type ArenaRunState,
  type ArenaRunSummary,
  type ArenaSetupReport,
} from '../types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function validUsage(value: unknown): boolean {
  return isRecord(value)
    && ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']
      .every(key => nonNegativeInteger(value[key]))
}

function validProgress(value: unknown): boolean {
  return isRecord(value)
    && ['notifications', 'events', 'toolCalls', 'modelCalls'].every(key => nonNegativeInteger(value[key]))
    && validUsage(value.usage)
    && Array.isArray(value.activity)
    && value.activity.every(item => isRecord(item)
      && typeof item.time === 'number'
      && typeof item.kind === 'string'
      && typeof item.detail === 'string')
}

function validFinding(value: unknown): boolean {
  return isRecord(value)
    && typeof value.ruleId === 'string'
    && ['critical', 'high', 'medium', 'low'].includes(String(value.severity))
    && typeof value.path === 'string'
    && typeof value.message === 'string'
    && (value.line === undefined || nonNegativeInteger(value.line))
    && (value.fingerprint === undefined || typeof value.fingerprint === 'string')
}

function validChangedFile(value: unknown): boolean {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.status === 'string'
    && nonNegativeInteger(value.added)
    && nonNegativeInteger(value.deleted)
    && typeof value.binary === 'boolean'
    && typeof value.untracked === 'boolean'
}

function validCheck(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && ['integrity', 'quality', 'test', 'logic', 'security'].includes(String(value.stage))
    && ['builtin', 'command', 'policy'].includes(String(value.kind))
    && typeof value.required === 'boolean'
    && Array.isArray(value.argv)
    && value.argv.every(item => typeof item === 'string')
    && ['passed', 'failed', 'error', 'cancelled', 'skipped'].includes(String(value.status))
    && nonNegativeInteger(value.durationMs)
    && typeof value.stdout === 'string'
    && typeof value.stderr === 'string'
}

function validDecision(value: unknown): boolean {
  return isRecord(value)
    && ['approved', 'rejected'].includes(String(value.status))
    && typeof value.decidedAt === 'number'
    && Array.isArray(value.reasons)
    && value.reasons.every(reason => typeof reason === 'string')
    && Array.isArray(value.stages)
    && value.stages.every(stage => isRecord(stage)
      && ['integrity', 'quality', 'test', 'logic', 'security'].includes(String(stage.stage))
      && ['approved', 'rejected', 'unavailable', 'not-configured'].includes(String(stage.status))
      && nonNegativeInteger(stage.requiredNodes)
      && nonNegativeInteger(stage.passedNodes))
}

function validReview(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && ['logic', 'security'].includes(String(value.stage))
    && typeof value.provider === 'string'
    && typeof value.model === 'string'
    && typeof value.childSessionId === 'string'
    && typeof value.status === 'string'
    && validUsage(value.usage)
    && validProgress(value.progress)
    && Array.isArray(value.findings)
    && value.findings.every(validFinding)
    && (value.failureCode === undefined || ['output-exhausted', 'invalid-output', 'runtime-error'].includes(String(value.failureCode)))
    && (value.repairAttempts === undefined || nonNegativeInteger(value.repairAttempts))
}

function validEvidence(value: unknown): boolean {
  return isRecord(value)
    && typeof value.passed === 'boolean'
    && typeof value.patchHash === 'string'
    && Array.isArray(value.changedFiles)
    && value.changedFiles.every(validChangedFile)
    && Array.isArray(value.checks)
    && value.checks.every(validCheck)
    && Array.isArray(value.securityFindings)
    && value.securityFindings.every(validFinding)
    && validDecision(value.decision)
}

function validHumanEvaluation(value: unknown): boolean {
  return isRecord(value)
    && typeof value.artifactHash === 'string'
    && ['passed', 'failed', 'inconclusive'].includes(String(value.verdict))
    && (value.note === undefined || typeof value.note === 'string')
    && nonNegativeInteger(value.recordedAt)
    && nonNegativeInteger(value.previewReadyAt)
    && value.source === 'loopback-user-attestation'
}

function validCandidateFileDiff(value: unknown): value is ArenaCandidateFileDiff {
  return isRecord(value)
    && typeof value.runId === 'string'
    && typeof value.contenderId === 'string'
    && typeof value.patchHash === 'string'
    && validChangedFile(value.file)
    && typeof value.diff === 'string'
    && nonNegativeInteger(value.totalChars)
    && typeof value.truncated === 'boolean'
}

function validDemoProject(value: unknown): value is ArenaDemoProject {
  return isRecord(value)
    && typeof value.path === 'string'
    && value.path.length > 0
    && value.template === 'commonjs-sum'
    && nonNegativeInteger(value.createdAt)
    && typeof value.suggestedTask === 'string'
    && value.suggestedTask.length > 0
}

function validRunBudget(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.limits) || !isRecord(value.consumed)) return false
  const limits = value.limits
  const consumed = value.consumed
  const exhausted = value.exhausted
  return ['totalTokens', 'modelCalls', 'wallTimeMs'].every(key => nonNegativeInteger(limits[key]))
    && ['totalTokens', 'modelCalls', 'wallTimeMs'].every(key => nonNegativeInteger(consumed[key]))
    && ['within-budget', 'exhausted'].includes(String(value.status))
    && nonNegativeInteger(value.stopAfterApproved)
    && Array.isArray(value.stoppedContenders)
    && value.stoppedContenders.every(item => typeof item === 'string')
    && (value.unlimitedBudgetAcknowledgedAt === undefined || nonNegativeInteger(value.unlimitedBudgetAcknowledgedAt))
    && (exhausted === undefined || (isRecord(exhausted)
      && ['totalTokens', 'modelCalls', 'wallTimeMs'].includes(String(exhausted.kind))
      && nonNegativeInteger(exhausted.limit)
      && nonNegativeInteger(exhausted.observed)
      && nonNegativeInteger(exhausted.at)))
}

function validRun(value: unknown): value is ArenaRunState {
  if (!isRecord(value)
    || value.version !== ARENA_STATE_VERSION
    || typeof value.runId !== 'string'
    || typeof value.workspaceId !== 'string'
    || typeof value.task !== 'string'
    || typeof value.repoRoot !== 'string'
    || typeof value.baseCommit !== 'string'
    || typeof value.status !== 'string'
    || !validRunBudget(value.budget)
    || !Array.isArray(value.contenders)) return false
  return value.contenders.every(contender => isRecord(contender)
    && typeof contender.id === 'string'
    && typeof contender.label === 'string'
    && typeof contender.provider === 'string'
    && typeof contender.model === 'string'
    && Array.isArray(contender.credentialRefs)
    && contender.credentialRefs.every(ref => typeof ref === 'string')
    && typeof contender.status === 'string'
    && typeof contender.worktreePath === 'string'
    && typeof contender.childSessionId === 'string'
    && validProgress(contender.progress)
    && Array.isArray(contender.reviews)
    && contender.reviews.every(validReview)
    && (contender.humanEvaluation === undefined || validHumanEvaluation(contender.humanEvaluation))
    && (contender.evidence === undefined || validEvidence(contender.evidence)))
}

function validRunResponse(value: unknown): value is ArenaRunResponse {
  return isRecord(value)
    && validRun(value.run)
    && Number.isSafeInteger(value.pollAfterMs)
    && (value.pollAfterMs as number) > 0
}

function validRunSummary(value: unknown): value is ArenaRunSummary {
  return isRecord(value)
    && typeof value.runId === 'string'
    && typeof value.workspaceId === 'string'
    && typeof value.task === 'string'
    && typeof value.status === 'string'
    && typeof value.updatedAt === 'number'
    && (value.winnerId === undefined || typeof value.winnerId === 'string')
    && (value.promotedId === undefined || typeof value.promotedId === 'string')
    && (value.totalTokens === undefined || nonNegativeInteger(value.totalTokens))
}

function validIdentity(value: unknown): boolean {
  return isRecord(value)
    && (value.organization === undefined || typeof value.organization === 'string')
    && (value.gateway === undefined || typeof value.gateway === 'string')
    && (value.modelFamily === undefined || typeof value.modelFamily === 'string')
}

function validPortableProgress(value: unknown): boolean {
  return isRecord(value)
    && ['notifications', 'events', 'toolCalls', 'modelCalls'].every(key => nonNegativeInteger(value[key]))
    && validUsage(value.usage)
}

function validPortableCheck(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && ['integrity', 'quality', 'test', 'logic', 'security'].includes(String(value.stage))
    && ['builtin', 'command', 'policy'].includes(String(value.kind))
    && typeof value.required === 'boolean'
    && ['passed', 'failed', 'error', 'cancelled', 'skipped'].includes(String(value.status))
    && (value.exitCode === null || Number.isSafeInteger(value.exitCode))
    && (value.signal === null || typeof value.signal === 'string')
    && typeof value.timedOut === 'boolean'
    && nonNegativeInteger(value.startedAt)
    && nonNegativeInteger(value.finishedAt)
    && nonNegativeInteger(value.durationMs)
    && typeof value.outputTruncated === 'boolean'
    && (value.sandbox === undefined || (isRecord(value.sandbox)
      && ['workspace-write', 'read-only'].includes(String(value.sandbox.mode))
      && ['full', 'partial', 'unavailable'].includes(String(value.sandbox.enforcement))
      && value.sandbox.networkIsolated === false
      && value.sandbox.hostReadsIsolated === false))
}

function validPortableReview(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && ['logic', 'security'].includes(String(value.stage))
    && typeof value.provider === 'string'
    && typeof value.model === 'string'
    && validIdentity(value.identity)
    && (value.artifactHash === undefined || typeof value.artifactHash === 'string')
    && ['queued', 'running', 'approved', 'rejected', 'failed', 'skipped', 'cancelled'].includes(String(value.status))
    && (value.startedAt === undefined || nonNegativeInteger(value.startedAt))
    && (value.finishedAt === undefined || nonNegativeInteger(value.finishedAt))
    && (value.durationMs === undefined || nonNegativeInteger(value.durationMs))
    && nonNegativeInteger(value.attempts)
    && validPortableProgress(value.progress)
    && (value.summary === undefined || typeof value.summary === 'string')
    && Array.isArray(value.findings)
    && value.findings.every(validFinding)
    && (value.failureCode === undefined || ['output-exhausted', 'invalid-output', 'runtime-error'].includes(String(value.failureCode)))
    && (value.repairAttempts === undefined || nonNegativeInteger(value.repairAttempts))
}

function validPortableContender(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.label !== 'string'
    || typeof value.provider !== 'string'
    || typeof value.model !== 'string'
    || !validIdentity(value.identity)
    || !['queued', 'preparing', 'recovering', 'running', 'judging', 'reviewing', 'passed', 'rejected', 'failed', 'cancelled'].includes(String(value.status))
    || !['admitted', 'worktree-ready', 'builder-complete', 'artifact-sealed', 'decision-complete'].includes(String(value.checkpoint))
    || !nonNegativeInteger(value.attempts)
    || (value.startedAt !== undefined && !nonNegativeInteger(value.startedAt))
    || (value.builderDurationMs !== undefined && !nonNegativeInteger(value.builderDurationMs))
    || (value.finishedAt !== undefined && !nonNegativeInteger(value.finishedAt))
    || (value.cleanedAt !== undefined && !nonNegativeInteger(value.cleanedAt))
    || !validPortableProgress(value.progress)
    || !Array.isArray(value.reviews)
    || !value.reviews.every(validPortableReview)
    || (value.humanEvaluation !== undefined && !validHumanEvaluation(value.humanEvaluation))) return false
  const artifact = value.artifact
  if (artifact !== undefined && (!isRecord(artifact)
    || typeof artifact.artifactHash !== 'string'
    || typeof artifact.headCommit !== 'string'
    || !nonNegativeInteger(artifact.patchBytes)
    || !nonNegativeInteger(artifact.untrackedBytes)
    || !Array.isArray(artifact.changedFiles)
    || !artifact.changedFiles.every(validChangedFile)
    || !nonNegativeInteger(artifact.addedLines)
    || !nonNegativeInteger(artifact.deletedLines)
    || !nonNegativeInteger(artifact.sealedAt))) return false
  const evaluation = value.evaluation
  return evaluation === undefined || (isRecord(evaluation)
    && typeof evaluation.patchHash === 'string'
    && Array.isArray(evaluation.checks)
    && evaluation.checks.every(validPortableCheck)
    && Array.isArray(evaluation.securityFindings)
    && evaluation.securityFindings.every(validFinding)
    && validDecision(evaluation.decision))
}

const FORBIDDEN_REPORT_KEYS = new Set([
  'repoRoot', 'worktreePath', 'credentialRefs', 'childSessionId', 'finalResponse',
  'response', 'error', 'argv', 'stdout', 'stderr', 'diff', 'diffPreview', 'activity',
  'lastEvent', 'rules', 'command', 'args',
])

function containsForbiddenReportKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenReportKey)
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, child]) => FORBIDDEN_REPORT_KEYS.has(key) || containsForbiddenReportKey(child))
}

function validPortableReport(value: unknown): value is ArenaPortableReport {
  if (!isRecord(value)
    || value.schemaVersion !== ARENA_REPORT_VERSION
    || !nonNegativeInteger(value.generatedAt)
    || typeof value.runId !== 'string'
    || typeof value.task !== 'string'
    || typeof value.baseCommit !== 'string'
    || !['queued', 'preparing', 'recovering', 'running', 'judging', 'reviewing', 'completed', 'failed', 'cancelled', 'budget-exhausted'].includes(String(value.status))
    || !nonNegativeInteger(value.createdAt)
    || !nonNegativeInteger(value.updatedAt)
    || !isRecord(value.policy)
    || !['host-config', 'repository'].includes(String(value.policy.source))
    || typeof value.policy.policyId !== 'string'
    || typeof value.policy.revision !== 'string'
    || typeof value.policy.digest !== 'string'
    || !isRecord(value.policy.signature)
    || !['not-present', 'ignored', 'verified', 'untrusted-key', 'invalid'].includes(String(value.policy.signature.status))
    || (value.policy.signature.keyId !== undefined && typeof value.policy.signature.keyId !== 'string')
    || !Array.isArray(value.contenders)
    || !value.contenders.every(validPortableContender)
    || !isRecord(value.privacy)
    || !nonNegativeInteger(value.privacy.redactionsApplied)
    || !nonNegativeInteger(value.privacy.truncationsApplied)
    || value.privacy.reviewBeforeSharing !== true
    || !stringArray(value.privacy.omitted)
    || !stringArray(value.limitations)
    || containsForbiddenReportKey(value)) return false
  if (!validRunBudget(value.budget)) return false
  const metrics = value.metrics
  if (metrics !== undefined && (!isRecord(metrics)
    || !['wallTimeMs', 'agentTimeMs', 'builders', 'reviewers', 'gateNodes'].every(key => nonNegativeInteger(metrics[key]))
    || !validUsage(metrics.usage)
    || !Array.isArray(metrics.byProvider)
    || !metrics.byProvider.every(group => isRecord(group)
      && typeof group.provider === 'string'
      && typeof group.model === 'string'
      && nonNegativeInteger(group.agents)
      && validUsage(group.usage)))) return false
  return true
}

function validPreview(value: unknown): value is ArenaPromotionPreview {
  return isRecord(value)
    && typeof value.token === 'string'
    && typeof value.runId === 'string'
    && typeof value.contenderId === 'string'
    && typeof value.patchHash === 'string'
    && Number.isSafeInteger(value.expiresAt)
    && Array.isArray(value.changedFiles)
    && value.changedFiles.every(validChangedFile)
    && Array.isArray(value.checks)
    && value.checks.every(validCheck)
    && validDecision(value.decision)
    && Array.isArray(value.securityFindings)
    && value.securityFindings.every(validFinding)
}

function validCandidatePreview(value: unknown): value is ArenaCandidatePreview {
  return isRecord(value)
    && typeof value.runId === 'string'
    && typeof value.contenderId === 'string'
    && typeof value.artifactHash === 'string'
    && ['idle', 'starting', 'running', 'stopped', 'failed', 'unavailable'].includes(String(value.status))
    && typeof value.stdout === 'string'
    && typeof value.stderr === 'string'
    && typeof value.outputTruncated === 'boolean'
    && (value.url === undefined || typeof value.url === 'string')
    && (value.pid === undefined || nonNegativeInteger(value.pid))
    && (value.readyAt === undefined || nonNegativeInteger(value.readyAt))
    && (value.error === undefined || typeof value.error === 'string')
    && (value.launch === undefined || (isRecord(value.launch)
      && ['static-output', 'package-script'].includes(String(value.launch.kind))
      && typeof value.launch.label === 'string'
      && Array.isArray(value.launch.argv)
      && value.launch.argv.every(item => typeof item === 'string')))
    && isRecord(value.safety)
    && value.safety.explicitStartRequired === true
    && value.safety.disposableWorktree === true
    && value.safety.loopbackRequested === true
    && typeof value.safety.networkIsolated === 'boolean'
    && typeof value.safety.hostReadsIsolated === 'boolean'
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function validSetup(value: unknown): value is ArenaSetupReport {
  if (!isRecord(value)
    || !isRecord(value.preflight)
    || typeof value.workspaceId !== 'string'
    || typeof value.policyText !== 'string'
    || typeof value.canWritePolicy !== 'boolean'
    || (value.repoRoot !== undefined && typeof value.repoRoot !== 'string')
    || (value.policyPath !== undefined && typeof value.policyPath !== 'string')
    || (value.loadedPolicyDigest !== undefined && typeof value.loadedPolicyDigest !== 'string')) return false
  const preflight = value.preflight
  const budget = preflight.budget
  return typeof preflight.ready === 'boolean'
    && typeof preflight.checkedAt === 'number'
    && stringArray(preflight.blockers)
    && stringArray(preflight.warnings)
    && isRecord(budget)
    && isRecord(budget.limits)
    && nonNegativeInteger(budget.limits.totalTokens)
    && nonNegativeInteger(budget.limits.modelCalls)
    && nonNegativeInteger(budget.limits.wallTimeMs)
    && nonNegativeInteger(budget.stopAfterApproved)
    && stringArray(budget.unlimited)
    && budget.unlimited.every(kind => ['totalTokens', 'modelCalls'].includes(kind))
    && typeof budget.requiresAcknowledgement === 'boolean'
    && Array.isArray(preflight.routes)
    && preflight.routes.every(route => isRecord(route)
      && typeof route.id === 'string'
      && typeof route.role === 'string'
      && typeof route.provider === 'string'
      && typeof route.model === 'string'
      && stringArray(route.credentialRefs)
      && isRecord(route.identity))
    && Array.isArray(preflight.credentials)
    && preflight.credentials.every(item => isRecord(item)
      && typeof item.ref === 'string'
      && typeof item.configured === 'boolean'
      && typeof item.writable === 'boolean'
      && stringArray(item.consumers))
    && Array.isArray(preflight.reviewCorrelations)
    && preflight.reviewCorrelations.every(item => isRecord(item)
      && typeof item.reviewerId === 'string'
      && typeof item.builderId === 'string'
      && stringArray(item.dimensions))
    && Array.isArray(preflight.remediations)
    && preflight.remediations.every(item => isRecord(item)
      && typeof item.id === 'string'
      && typeof item.severity === 'string'
      && typeof item.title === 'string'
      && typeof item.detail === 'string'
      && typeof item.action === 'string')
    && isRecord(preflight.policy)
    && typeof preflight.policy.policyId === 'string'
    && typeof preflight.policy.revision === 'string'
    && typeof preflight.policy.digest === 'string'
}

async function call(rpc: ClientConnectionRpc, channel: string, endpoint: string, payload: unknown): Promise<unknown> {
  const result = await rpc.call(channel, endpoint, payload)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Validated browser port shared by the launcher, workbench, and run detail. */
export interface ArenaCardFace {
  isLoopback: boolean
  /** Use the official Harness folder picker and Workspace registry. */
  readonly addWorkspace: () => Promise<{ workspaceId: string } | undefined>
  /** Create a bounded demo repository, then register it through the official Workspace service. */
  readonly createDemoWorkspace: () => Promise<ArenaDemoProject & { workspaceId: string }>
  /** Store a write-only value through the official Harness credentials domain. */
  readonly setCredential: (ref: string, value: string) => Promise<void>
  readonly list: () => Promise<readonly ArenaRunSummary[]>
  readonly start: (
    workspaceId: string,
    task: string,
    options?: { acknowledgeUnlimitedBudget?: boolean },
  ) => Promise<ArenaRunResponse>
  readonly retry: (runId: string, options?: { acknowledgeUnlimitedBudget?: boolean }) => Promise<ArenaRunResponse>
  readonly loadRun: (runId: string) => Promise<ArenaRunResponse>
  readonly loadReport: (runId: string) => Promise<ArenaPortableReport>
  readonly loadFileDiff: (runId: string, contenderId: string, path: string) => Promise<ArenaCandidateFileDiff>
  readonly loadCandidatePreview: (runId: string, contenderId: string) => Promise<ArenaCandidatePreview>
  readonly startCandidatePreview: (runId: string, contenderId: string) => Promise<ArenaCandidatePreview>
  readonly stopCandidatePreview: (runId: string, contenderId: string) => Promise<ArenaCandidatePreview>
  readonly recordHumanEvaluation: (
    runId: string,
    contenderId: string,
    verdict: 'passed' | 'failed' | 'inconclusive',
    note?: string,
  ) => Promise<ArenaRunResponse>
  readonly loadSetup: (workspaceId: string) => Promise<ArenaSetupReport>
  readonly writePolicy: (workspaceId: string, policyText: string) => Promise<ArenaSetupReport>
  readonly cancel: (runId: string) => Promise<ArenaRunResponse>
  readonly cleanup: (runId: string) => Promise<ArenaRunResponse>
  readonly preview: (runId: string, contenderId: string) => Promise<ArenaPromotionPreview>
  readonly confirm: (token: string) => Promise<ArenaRunResponse>
}

/** Official Web integrations kept outside Arena's Host-owned RPC surface. */
export interface ArenaWebIntegration {
  pickAndRegisterWorkspace: () => Promise<string | undefined>
  registerWorkspace: (path: string) => Promise<string>
  setCredential: (ref: string, value: string) => Promise<void>
}

const unavailableWebIntegration: ArenaWebIntegration = {
  pickAndRegisterWorkspace: async () => { throw new Error('Harness Workspace integration is unavailable') },
  registerWorkspace: async () => { throw new Error('Harness Workspace integration is unavailable') },
  setCredential: async () => { throw new Error('Harness credential integration is unavailable') },
}

/** Build one root-scoped RPC face; components receive functions, never Client Context. */
export function arenaCardFace(
  rpc: ClientConnectionRpc,
  isLoopback: boolean,
  integration: ArenaWebIntegration = unavailableWebIntegration,
): ArenaCardFace {
  const runResponse = async (channel: string, endpoint: string, payload: unknown): Promise<ArenaRunResponse> => {
    const value = await call(rpc, channel, endpoint, payload)
    if (!validRunResponse(value)) throw new Error(`Arena ${endpoint} returned an invalid run response`)
    return value
  }
  return {
    isLoopback,
    addWorkspace: async () => {
      const workspaceId = await integration.pickAndRegisterWorkspace()
      return workspaceId === undefined ? undefined : { workspaceId }
    },
    createDemoWorkspace: async () => {
      const value = await call(rpc, '/arena-control', 'demo-create', {})
      if (!validDemoProject(value)) throw new Error('Arena demo creation returned an invalid response')
      const workspaceId = await integration.registerWorkspace(value.path)
      return { ...value, workspaceId }
    },
    setCredential: async (ref, value) => {
      const normalized = value.trim()
      if (normalized.length === 0) throw new Error('credential value must not be empty')
      await integration.setCredential(ref, normalized)
    },
    list: async () => {
      const value = await call(rpc, '/arena-read', 'list', {})
      if (!Array.isArray(value) || !value.every(validRunSummary)) throw new Error('Arena list returned an invalid response')
      return value
    },
    start: async (workspaceId, task, options) => await runResponse('/arena-control', 'start', {
      workspaceId,
      task,
      acknowledgeUnlimitedBudget: options?.acknowledgeUnlimitedBudget === true,
    }),
    retry: async (runId, options) => await runResponse('/arena-control', 'retry', {
      runId,
      acknowledgeUnlimitedBudget: options?.acknowledgeUnlimitedBudget === true,
    }),
    loadRun: async runId => await runResponse('/arena-read', 'run', { runId }),
    loadReport: async runId => {
      const value = await call(rpc, '/arena-read', 'report', { runId })
      if (!validPortableReport(value)) throw new Error('Arena report returned an invalid response')
      return value
    },
    loadFileDiff: async (runId, contenderId, path) => {
      const value = await call(rpc, '/arena-read', 'candidate-file-diff', { runId, contenderId, path })
      if (!validCandidateFileDiff(value)) throw new Error('Arena candidate file diff returned an invalid response')
      return value
    },
    loadCandidatePreview: async (runId, contenderId) => {
      const value = await call(rpc, '/arena-read', 'candidate-preview', { runId, contenderId })
      if (!validCandidatePreview(value)) throw new Error('Arena candidate preview returned an invalid response')
      return value
    },
    startCandidatePreview: async (runId, contenderId) => {
      const value = await call(rpc, '/arena-control', 'candidate-preview-start', { runId, contenderId, acknowledged: true })
      if (!validCandidatePreview(value)) throw new Error('Arena candidate preview start returned an invalid response')
      return value
    },
    stopCandidatePreview: async (runId, contenderId) => {
      const value = await call(rpc, '/arena-control', 'candidate-preview-stop', { runId, contenderId })
      if (!validCandidatePreview(value)) throw new Error('Arena candidate preview stop returned an invalid response')
      return value
    },
    recordHumanEvaluation: async (runId, contenderId, verdict, note) => await runResponse(
      '/arena-control',
      'human-evaluation',
      { runId, contenderId, verdict, acknowledged: true, ...note === undefined ? {} : { note } },
    ),
    loadSetup: async (workspaceId) => {
      const value = await call(rpc, '/arena-read', 'setup', { workspaceId })
      if (!validSetup(value)) throw new Error('Arena setup returned an invalid response')
      return value
    },
    writePolicy: async (workspaceId, policyText) => {
      const value = await call(rpc, '/arena-control', 'policy-write', { workspaceId, policyText })
      if (!validSetup(value)) throw new Error('Arena policy write returned an invalid response')
      return value
    },
    cancel: async runId => await runResponse('/arena-control', 'cancel', { runId }),
    cleanup: async runId => await runResponse('/arena-control', 'cleanup', { runId }),
    preview: async (runId, contenderId) => {
      const value = await call(rpc, '/arena-control', 'promotion-preview', { runId, contenderId })
      if (!validPreview(value)) throw new Error('Arena promotion preview returned an invalid response')
      return value
    },
    confirm: async token => await runResponse('/arena-control', 'promotion-confirm', { token }),
  }
}
