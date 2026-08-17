/** Validated client port over Arena's trusted-read and loopback-control RPC channels. */

import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  ARENA_STATE_VERSION,
  type ArenaCandidateFileDiff,
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
      && ['approved', 'rejected', 'not-configured'].includes(String(stage.status))
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

function validRun(value: unknown): value is ArenaRunState {
  if (!isRecord(value)
    || value.version !== ARENA_STATE_VERSION
    || typeof value.runId !== 'string'
    || typeof value.workspaceId !== 'string'
    || typeof value.task !== 'string'
    || typeof value.repoRoot !== 'string'
    || typeof value.baseCommit !== 'string'
    || typeof value.status !== 'string'
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
  return typeof preflight.ready === 'boolean'
    && typeof preflight.checkedAt === 'number'
    && stringArray(preflight.blockers)
    && stringArray(preflight.warnings)
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
  readonly list: () => Promise<readonly ArenaRunSummary[]>
  readonly start: (workspaceId: string, task: string) => Promise<ArenaRunResponse>
  readonly retry: (runId: string) => Promise<ArenaRunResponse>
  readonly loadRun: (runId: string) => Promise<ArenaRunResponse>
  readonly loadFileDiff: (runId: string, contenderId: string, path: string) => Promise<ArenaCandidateFileDiff>
  readonly loadSetup: (workspaceId: string) => Promise<ArenaSetupReport>
  readonly writePolicy: (workspaceId: string, policyText: string) => Promise<ArenaSetupReport>
  readonly cancel: (runId: string) => Promise<ArenaRunResponse>
  readonly cleanup: (runId: string) => Promise<ArenaRunResponse>
  readonly preview: (runId: string, contenderId: string) => Promise<ArenaPromotionPreview>
  readonly confirm: (token: string) => Promise<ArenaRunResponse>
}

/** Build one root-scoped RPC face; components receive functions, never Client Context. */
export function arenaCardFace(
  rpc: ClientConnectionRpc,
  isLoopback: boolean,
): ArenaCardFace {
  const runResponse = async (channel: string, endpoint: string, payload: unknown): Promise<ArenaRunResponse> => {
    const value = await call(rpc, channel, endpoint, payload)
    if (!validRunResponse(value)) throw new Error(`Arena ${endpoint} returned an invalid run response`)
    return value
  }
  return {
    isLoopback,
    list: async () => {
      const value = await call(rpc, '/arena-read', 'list', {})
      if (!Array.isArray(value) || !value.every(validRunSummary)) throw new Error('Arena list returned an invalid response')
      return value
    },
    start: async (workspaceId, task) => await runResponse('/arena-control', 'start', { workspaceId, task }),
    retry: async runId => await runResponse('/arena-control', 'retry', { runId }),
    loadRun: async runId => await runResponse('/arena-read', 'run', { runId }),
    loadFileDiff: async (runId, contenderId, path) => {
      const value = await call(rpc, '/arena-read', 'candidate-file-diff', { runId, contenderId, path })
      if (!validCandidateFileDiff(value)) throw new Error('Arena candidate file diff returned an invalid response')
      return value
    },
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
