/** Browser-safe Evidence Arena contracts shared by the Host and Web faces. */

/** On-disk format version for Arena run snapshots and state events. */
export const ARENA_STATE_VERSION = 4 as const

/** Repository policy document format understood by this Arena release. */
export const ARENA_POLICY_VERSION = 1 as const

/** Lifecycle of one complete multi-contender run. */
export type ArenaRunStatus =
  | 'queued'
  | 'preparing'
  | 'recovering'
  | 'running'
  | 'judging'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget-exhausted'

/** Lifecycle of one isolated contender. */
export type ArenaContenderStatus =
  | 'queued'
  | 'preparing'
  | 'recovering'
  | 'running'
  | 'judging'
  | 'reviewing'
  | 'passed'
  | 'rejected'
  | 'failed'
  | 'cancelled'

/** Durable progress boundary used to resume work after a Host restart. */
export type ArenaContenderCheckpoint =
  | 'admitted'
  | 'worktree-ready'
  | 'builder-complete'
  | 'artifact-sealed'
  | 'decision-complete'

/** Ordered review pipeline stages. */
export type ArenaGateStage = 'integrity' | 'quality' | 'test' | 'logic' | 'security'

/** A provider-neutral token accounting value. Buckets are disjoint. */
export interface ArenaTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
}

/** Bounded progress summary derived from one child SDK notification. */
export interface ArenaActivity {
  /** Milliseconds since Unix epoch. */
  time: number
  /** Wire event/status type, such as `tool/call` or `session.status`. */
  kind: string
  /** Short, content-bounded human-readable detail. */
  detail: string
}

/** Aggregate child-runtime progress; model chain-of-thought is never copied here. */
export interface ArenaProgress {
  notifications: number
  events: number
  toolCalls: number
  modelCalls: number
  usage: ArenaTokenUsage
  lastEvent?: string
  activity: ArenaActivity[]
}

/** One changed path measured against the run's immutable base commit. */
export interface ArenaChangedFile {
  path: string
  status: string
  added: number
  deleted: number
  binary: boolean
  untracked: boolean
}

/** File-effect isolation facts for one executable review node. */
export interface ArenaSandboxFacts {
  mode: 'workspace-write' | 'read-only'
  enforcement: 'full' | 'partial' | 'unavailable'
  /** Harness' current sandbox governs file effects, not network or host reads. */
  networkIsolated: false
  hostReadsIsolated: false
}

/** Result of one deterministic gate command or built-in policy check. */
export interface ArenaCheckResult {
  id: string
  label: string
  stage: ArenaGateStage
  kind: 'builtin' | 'command' | 'policy'
  required: boolean
  argv: string[]
  status: 'passed' | 'failed' | 'error' | 'cancelled' | 'skipped'
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  startedAt: number
  finishedAt: number
  durationMs: number
  stdout: string
  stderr: string
  outputTruncated: boolean
  sandbox?: ArenaSandboxFacts
}

/** A deterministic security finding. Secret values are never retained. */
export interface ArenaSecurityFinding {
  ruleId: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  path: string
  line?: number
  message: string
  /** SHA-256 of the matching line/value for correlation without secret disclosure. */
  fingerprint?: string
}

/** One independent model review over a captured candidate. */
export interface ArenaReviewState {
  id: string
  label: string
  stage: 'logic' | 'security'
  provider: string
  model: string
  identity: ArenaModelIdentity
  childSessionId: string
  /** Exact sealed artifact reviewed by this node; independent of mutable worktree state. */
  artifactHash?: string
  status: 'queued' | 'running' | 'approved' | 'rejected' | 'failed' | 'skipped' | 'cancelled'
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  usage: ArenaTokenUsage
  progress: ArenaProgress
  summary?: string
  findings: ArenaSecurityFinding[]
  response?: string
  responseTruncated?: boolean
  error?: string
  /** Number of child invocations, including a restart recovery attempt. */
  attempts: number
}

/** Stage-by-stage final decision; only `approved` candidates are promotable. */
export interface ArenaApprovalDecision {
  status: 'approved' | 'rejected'
  decidedAt: number
  reasons: string[]
  stages: Array<{
    stage: ArenaGateStage
    status: 'approved' | 'rejected' | 'not-configured'
    requiredNodes: number
    passedNodes: number
  }>
}

/** Captured, promotion-ready evidence for a contender. */
export interface ArenaEvidence {
  /** Final strict-policy decision; retained for compatibility with winner selection. */
  passed: boolean
  patchHash: string
  patchBytes: number
  untrackedBytes: number
  changedFiles: ArenaChangedFile[]
  addedLines: number
  deletedLines: number
  diffPreview: string
  diffPreviewTruncated: boolean
  checks: ArenaCheckResult[]
  securityFindings: ArenaSecurityFinding[]
  decision: ArenaApprovalDecision
}

/** One lazily loaded, integrity-checked file diff for the browser review tree. */
export interface ArenaCandidateFileDiff {
  runId: string
  contenderId: string
  patchHash: string
  file: ArenaChangedFile
  /** Unified text diff; empty for a binary file. */
  diff: string
  totalChars: number
  truncated: boolean
}

/** Immutable capture metadata persisted before deterministic or model review starts. */
export interface ArenaSealedArtifact {
  artifactHash: string
  headCommit: string
  patchBytes: number
  untrackedBytes: number
  changedFiles: ArenaChangedFile[]
  addedLines: number
  deletedLines: number
  diffPreview: string
  diffPreviewTruncated: boolean
  sealedAt: number
}

/** State of one independently configured child runtime and Git worktree. */
export interface ArenaContenderState {
  id: string
  label: string
  provider: string
  model: string
  identity: ArenaModelIdentity
  credentialRefs: string[]
  status: ArenaContenderStatus
  worktreePath: string
  childSessionId: string
  checkpoint: ArenaContenderCheckpoint
  /** Number of Builder child invocations, including recovery attempts. */
  attempts: number
  startedAt?: number
  /** Builder runtime only; excludes deterministic gates and independent reviews. */
  builderDurationMs?: number
  finishedAt?: number
  headCommit?: string
  finalResponse?: string
  finalResponseTruncated?: boolean
  error?: string
  progress: ArenaProgress
  reviews: ArenaReviewState[]
  sealedArtifact?: ArenaSealedArtifact
  evidence?: ArenaEvidence
  cleanedAt?: number
}

/** Transparent mechanical leader selection, never a correctness claim or hidden weighted score. */
export interface ArenaWinner {
  contenderId: string
  reason: string
  tieBreak: string[]
}

/** Aggregate metering derived from every builder and reviewer node. */
export interface ArenaRunMetrics {
  wallTimeMs: number
  agentTimeMs: number
  builders: number
  reviewers: number
  gateNodes: number
  usage: ArenaTokenUsage
  byProvider: Array<{
    provider: string
    model: string
    agents: number
    usage: ArenaTokenUsage
  }>
}

/** Host-enforced whole-run budget and the first observed exhaustion fact. */
export interface ArenaRunBudget {
  limits: {
    /** Zero disables the corresponding token limit. */
    totalTokens: number
    /** Zero disables the corresponding model-call limit. */
    modelCalls: number
    wallTimeMs: number
  }
  consumed: {
    totalTokens: number
    modelCalls: number
    wallTimeMs: number
  }
  status: 'within-budget' | 'exhausted'
  exhausted?: {
    kind: 'totalTokens' | 'modelCalls' | 'wallTimeMs'
    limit: number
    observed: number
    at: number
  }
  /** Zero disables approval-triggered sibling cancellation. */
  stopAfterApproved: number
  stoppedContenders: string[]
}

/** One model deployment identity used for multi-dimensional independence checks. */
export interface ArenaModelIdentity {
  organization?: string
  gateway?: string
  modelFamily?: string
}

/** Complete project-owned policy applied to one immutable run. */
export interface ArenaProjectPolicyRules {
  judgeCommands: ArenaJudgeCommandConfig[]
  requireChanges: boolean
  requireProjectTests: boolean
  requireLogicReview: boolean
  requireSecurityReview: boolean
  allowBinaryFiles: boolean
  maxChangedFiles: number
  maxReviewInputChars: number
  protectedPathPatterns: string[]
  /** Exact repository-relative files included beside the deterministic tree index. */
  sharedContextPaths: string[]
}

/** Optional detached signature carried by a repository policy document. */
export interface ArenaPolicySignature {
  algorithm: 'ed25519'
  keyId: string
  value: string
}

/** Version-controlled repository policy document. */
export interface ArenaPolicyPackDocument {
  schemaVersion: typeof ARENA_POLICY_VERSION
  policyId: string
  revision: string
  rules: ArenaProjectPolicyRules
  signature?: ArenaPolicySignature
}

/** Verified and fully resolved policy snapshot retained with a run. */
export interface ArenaPolicySnapshot {
  source: 'host-config' | 'repository'
  path?: string
  policyId: string
  revision: string
  digest: string
  signature: {
    status: 'not-present' | 'ignored' | 'verified' | 'untrusted-key' | 'invalid'
    keyId?: string
  }
  rules: ArenaProjectPolicyRules
}

/** One shared, immutable repository-context prefix reused by every Builder. */
export interface ArenaSharedContext {
  artifactHash: string
  bytes: number
  indexedFiles: number
  includedPaths: string[]
  truncatedIndex: boolean
  cacheEligibleContenders: string[]
}

/** Restart recovery audit facts for one run. */
export interface ArenaRecoveryState {
  attempts: number
  lastRecoveredAt: number
  fromStatus: ArenaRunStatus
  resumedContenders: string[]
}

/** Write-ahead state for a non-atomic multi-file promotion. */
export interface ArenaPromotionTransaction {
  id: string
  contenderId: string
  patchHash: string
  phase: 'prepared' | 'applying' | 'applied' | 'committed' | 'rolled-back' | 'needs-attention'
  startedAt: number
  updatedAt: number
  copiedPaths: string[]
  error?: string
}

/** A successful guarded promotion into the original working tree. */
export interface ArenaPromotion {
  contenderId: string
  patchHash: string
  promotedAt: number
  changedFiles: string[]
  verification: string[]
}

/** Complete durable projection of one Arena run. */
export interface ArenaRunState {
  version: typeof ARENA_STATE_VERSION
  runId: string
  /** Stable DSH Workspace that admitted this run. */
  workspaceId: string
  task: string
  repoRoot: string
  baseCommit: string
  status: ArenaRunStatus
  revision: number
  createdAt: number
  updatedAt: number
  policy: ArenaPolicySnapshot
  budget: ArenaRunBudget
  contenders: ArenaContenderState[]
  sharedContext?: ArenaSharedContext
  recovery?: ArenaRecoveryState
  winner?: ArenaWinner
  metrics?: ArenaRunMetrics
  promotionTransaction?: ArenaPromotionTransaction
  promotion?: ArenaPromotion
  error?: string
}

/** Authoritative append-only state event. Every event carries a full recoverable projection. */
export interface ArenaStateEvent {
  version: typeof ARENA_STATE_VERSION
  seq: number
  time: number
  type:
    | 'run/created'
    | 'run/status'
    | 'run/context'
    | 'contender/status'
    | 'contender/progress'
    | 'contender/artifact'
    | 'contender/evidence'
    | 'review/status'
    | 'run/winner'
    | 'run/recovered'
    | 'run/budget'
    | 'run/early-stop'
    | 'run/promotion-transaction'
    | 'run/promotion'
    | 'run/cleanup'
    | 'run/error'
  note: string
  state: ArenaRunState
}

/** Provider/model/credential facts shared by builders and review agents. */
export interface ArenaAgentRouteConfig {
  provider: string
  model: string
  systemPrompt: string
  /** Environment-variable names only. Their values never enter config or state. */
  credentialEnv: string[]
  maxTokens?: number
  /** Deployment facts used to detect correlated builder/reviewer failures. */
  identity?: ArenaModelIdentity
}

/** One configured independent builder recipe. */
export interface ArenaContenderConfig extends ArenaAgentRouteConfig {
  id: string
  label: string
}

/** One independent structured reviewer. */
export interface ArenaReviewerConfig extends ArenaAgentRouteConfig {
  id: string
  label: string
  stage: 'logic' | 'security'
  required: boolean
}

/** Safe, non-secret pi-ai provider route configuration. */
export interface ArenaProviderProfile {
  apiKeyEnv: string
  displayName?: string
  api?: string
  baseURL?: string
  models?: Array<{
    id: string
    name?: string
    contextWindow?: number
    maxTokens?: number
  }>
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

/** Secret-free readiness report. Credential values never cross this contract. */
export interface ArenaPreflight {
  ready: boolean
  checkedAt: number
  blockers: string[]
  warnings: string[]
  routes: Array<{
    id: string
    role: 'builder' | 'logic-reviewer' | 'security-reviewer'
    provider: string
    model: string
    credentialRefs: string[]
    identity: ArenaModelIdentity
  }>
  credentials: Array<{
    ref: string
    configured: boolean
    source?: string
    writable: boolean
    consumers: string[]
  }>
  /** Identity overlaps that can correlate builder and reviewer errors. */
  reviewCorrelations: Array<{
    reviewerId: string
    builderId: string
    dimensions: Array<'provider' | 'organization' | 'gateway' | 'modelFamily'>
  }>
  policy: ArenaPolicySnapshot
  remediations: ArenaPreflightRemediation[]
  gates: {
    requireProjectTests: boolean
    requireLogicReview: boolean
    requireSecurityReview: boolean
    reviewerIndependence: 'off' | 'warn' | 'require'
    requireFullSandbox: boolean
    revalidateOnPromotion: boolean
    commands: Array<{ id: string; stage: 'quality' | 'test'; required: boolean; argv: string[] }>
  }
  isolation: {
    fileEffects: 'harness-sandbox'
    networkIsolated: false
    hostReadsIsolated: false
  }
}

/** Structured repair guidance rendered by the preflight setup card. */
export interface ArenaPreflightRemediation {
  id: string
  severity: 'blocker' | 'warning'
  title: string
  detail: string
  action: 'configure-credential' | 'write-policy-pack' | 'edit-profile' | 'clean-worktree' | 'inspect-platform'
}

/** Cached workspace-scoped setup information for the graphical workbench. */
export interface ArenaSetupReport {
  preflight: ArenaPreflight
  workspaceId: string
  repoRoot?: string
  policyPath?: string
  policyText: string
  loadedPolicyDigest?: string
  canWritePolicy: boolean
}

/** One argv-only judge command; no shell parsing occurs. */
export interface ArenaJudgeCommandConfig {
  id: string
  label: string
  stage: 'quality' | 'test'
  required: boolean
  command: string
  args: string[]
  timeoutMs: number
}

/** Stable promotion preview returned before any original-worktree write. */
export interface ArenaPromotionPreview {
  token: string
  runId: string
  contenderId: string
  repoRoot: string
  baseCommit: string
  patchHash: string
  expiresAt: number
  changedFiles: ArenaChangedFile[]
  checks: ArenaCheckResult[]
  decision: ArenaApprovalDecision
  securityFindings: ArenaSecurityFinding[]
}

/** Read-channel response for the Arena workbench. */
export interface ArenaRunResponse {
  run: ArenaRunState
  pollAfterMs: number
}

/** Summary used by the workbench history surface. */
export interface ArenaRunSummary {
  runId: string
  workspaceId: string
  task: string
  status: ArenaRunStatus
  updatedAt: number
  winnerId?: string
  promotedId?: string
  totalTokens?: number
}

/** An all-zero usage accumulator. */
export function zeroTokenUsage(): ArenaTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
}

/** Determine whether a run still owns live child work. */
export function isActiveArenaStatus(status: ArenaRunStatus): boolean {
  return status === 'queued' || status === 'preparing' || status === 'recovering' || status === 'running'
    || status === 'judging' || status === 'reviewing'
}
