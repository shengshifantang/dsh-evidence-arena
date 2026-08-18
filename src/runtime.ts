/** Independent, sandboxed DeepSeek Harness SDK runtime used by builders and reviewers. */

import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { DeepSeekHarness, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { ResolvedConfig } from './config.ts'
import {
  zeroTokenUsage,
  type ArenaAgentRouteConfig,
  type ArenaProgress,
  type ArenaTokenUsage,
} from './types.ts'

/** Complete child launch request. */
export interface ArenaRuntimeSpec {
  runId: string
  role: 'builder' | 'reviewer'
  agentId: string
  agent: ArenaAgentRouteConfig
  /** Role-specific persona; Builder requests use one shared cache-stable value. */
  systemPrompt: string
  prompt: string
  worktreePath: string
  childSessionId: string
  childSessionRoot: string
  permissionMode: 'workspace-write' | 'read-only'
}

/** Bounded child result retained as agent evidence. */
export interface ArenaRuntimeResult {
  finalResponse: string
  events: number
  notifications: number
  usage: ArenaTokenUsage
}

/** Testable runtime seam; one invocation owns one whole child process. */
export interface ArenaRuntimeRunner {
  run(
    spec: ArenaRuntimeSpec,
    onProgress: (progress: ArenaProgress) => Promise<void>,
    signal: AbortSignal,
  ): Promise<ArenaRuntimeResult>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegative(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0
}

function usageValue(value: unknown): ArenaTokenUsage | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = nonNegative(value.inputTokens)
  const outputTokens = nonNegative(value.outputTokens)
  const cacheReadTokens = nonNegative(value.cacheReadTokens)
  const cacheWriteTokens = nonNegative(value.cacheWriteTokens)
  const reasoningTokens = nonNegative(value.reasoningTokens)
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
  }
}

function usageSample(event: unknown): { key: string; usage: ArenaTokenUsage } | undefined {
  if (!isRecord(event) || !isRecord(event.data)) return undefined
  const turn = nonNegative(event.data.turn)
  const step = nonNegative(event.data.step)
  if (event.type === 'assistant/chunk' && isRecord(event.data.chunk) && event.data.chunk.type === 'usage') {
    const usage = usageValue(event.data.chunk.usage)
    return usage === undefined ? undefined : { key: `${turn}/${step}`, usage }
  }
  if (event.type === 'assistant/message') {
    const usage = usageValue(event.data.usage)
    return usage === undefined ? undefined : { key: `${turn}/${step}`, usage }
  }
  return undefined
}

function sumUsage(values: Iterable<ArenaTokenUsage>): ArenaTokenUsage {
  const total = zeroTokenUsage()
  for (const usage of values) {
    total.inputTokens += usage.inputTokens
    total.outputTokens += usage.outputTokens
    total.cacheReadTokens += usage.cacheReadTokens
    total.cacheWriteTokens += usage.cacheWriteTokens
    total.reasoningTokens += usage.reasoningTokens
    total.totalTokens += usage.totalTokens
  }
  return total
}

function eventSummary(notification: HarnessNotification): { kind: string; detail: string; toolCall: boolean } {
  if (notification.method === 'session.status') {
    const status = typeof notification.params.status === 'string' ? notification.params.status : 'unknown'
    return { kind: 'session.status', detail: status, toolCall: false }
  }
  if (notification.method !== 'session.event') {
    return { kind: notification.method, detail: 'runtime notification', toolCall: false }
  }
  const event = isRecord(notification.params.event) ? notification.params.event : undefined
  const type = typeof event?.type === 'string' ? event.type : 'session.event'
  if (type === 'tool/call') {
    const data = isRecord(event?.data) ? event.data : undefined
    const name = typeof data?.name === 'string' ? data.name : 'unknown tool'
    return { kind: type, detail: name, toolCall: true }
  }
  if (type === 'tool/result') return { kind: type, detail: 'tool completed', toolCall: false }
  if (type === 'assistant/chunk') return { kind: type, detail: 'assistant streaming', toolCall: false }
  if (type === 'assistant/message') return { kind: type, detail: 'assistant response completed', toolCall: false }
  return { kind: type, detail: 'runtime event', toolCall: false }
}

function defaultRuntimeConfigPath(): string {
  return fileURLToPath(new URL('../runtime/cordis.yml', import.meta.url))
}

function runtimeBinPath(): string {
  return fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sdk-jsonrpc-demo/bin'))
}

/** Fail plugin startup when the configured child composition or built SDK bin is unavailable. */
export async function validateRuntimeAssets(config: ResolvedConfig): Promise<void> {
  const runtimeConfig = config.runtimeConfig ?? defaultRuntimeConfigPath()
  const bin = runtimeBinPath()
  try {
    await Promise.all([access(runtimeConfig, constants.R_OK), access(bin, constants.R_OK)])
  } catch (error) {
    throw new Error(`dsh-arena child runtime assets are unavailable (config: ${runtimeConfig}, bin: ${bin})`, { cause: error })
  }
}

async function runtimeEnvironment(
  config: ResolvedConfig,
  spec: ArenaRuntimeSpec,
  credentials: CredentialProvider,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...scrubbedParentEnv() }
  for (const name of spec.agent.credentialEnv) {
    const resolved = await credentials.resolve(credentialRef(name))
    if (resolved !== undefined) env[name] = resolved.value
  }
  const profile = spec.agent.provider === 'deepseek-official'
    ? undefined
    : config.providerProfiles[spec.agent.provider]
  const primaryCredential = profile?.apiKeyEnv ?? spec.agent.credentialEnv[0]
  if (primaryCredential === undefined || env[primaryCredential] === undefined || env[primaryCredential].length === 0) {
    throw new Error(
      `credential ${primaryCredential ?? '<unspecified>'} is not available to Arena agent ${spec.agentId}; `
      + 'configure that reference in Harness Models or export it before starting DSH',
    )
  }
  Object.assign(env, config.runtimeEnv)
  // Never expose the live Host profile root to a model-facing child shell.
  // The sandbox confines writes but does not promise to confine host reads;
  // a parent DSH_HOME may contain .credentials.yaml. Project-local Skills are
  // still discovered from the worktree. User-wide Skills/plugins need a future
  // explicit allowlisted pack rather than implicit profile inheritance.
  const childHome = join(spec.childSessionRoot, 'runtime-home')
  const childAgentsHome = join(childHome, 'agents-home')
  await Promise.all([
    mkdir(childHome, { recursive: true, mode: 0o700 }),
    mkdir(childAgentsHome, { recursive: true, mode: 0o700 }),
  ])
  env.DSH_ARENA_CHILD_HOME = childHome
  env.DSH_ARENA_CHILD_AGENTS_HOME = childAgentsHome
  env.DSH_HOME = childHome
  env.DSH_AGENTS_HOME = childAgentsHome
  env.DSH_CORDIS_CONFIG = config.runtimeConfig ?? defaultRuntimeConfigPath()
  env.DSH_CWD = spec.worktreePath
  env.DSH_SESSION_ROOT = spec.childSessionRoot
  env.DSH_SYSTEM_PROMPT = spec.systemPrompt
  env.DSH_PERMISSION_MODE = spec.permissionMode
  env.DSH_ARENA_ROLE = spec.role
  env.DSH_ARENA_API_KEY_ENV = primaryCredential
  env.DSH_ARENA_PI_AI_CONFIG = JSON.stringify({
    providers: profile === undefined ? {} : { [spec.agent.provider]: profile },
  })
  return env
}

/** Real runner: a fresh JSON-RPC DSH process, session store, model route, and Harness sandbox per agent. */
export class SdkArenaRuntimeRunner implements ArenaRuntimeRunner {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly credentials: CredentialProvider,
  ) {}

  async run(
    spec: ArenaRuntimeSpec,
    onProgress: (progress: ArenaProgress) => Promise<void>,
    signal: AbortSignal,
  ): Promise<ArenaRuntimeResult> {
    signal.throwIfAborted()
    const env = await runtimeEnvironment(this.config, spec, this.credentials)
    const harness = new DeepSeekHarness({
      launch: {
        command: process.execPath,
        args: [runtimeBinPath(), env.DSH_CORDIS_CONFIG as string],
        cwd: spec.worktreePath,
        env,
        requestTimeoutMs: this.config.runTimeoutMs,
        shutdownTimeoutMs: 1_000,
        disposeEofGraceMs: 6_000,
        disposeGraceMs: this.config.processGraceMs,
      },
      cwd: spec.worktreePath,
      provider: spec.agent.provider,
      model: spec.agent.model,
      ...spec.agent.maxTokens === undefined ? {} : { maxTokens: spec.agent.maxTokens },
    })

    const progress: ArenaProgress = {
      notifications: 0,
      events: 0,
      toolCalls: 0,
      modelCalls: 0,
      usage: zeroTokenUsage(),
      activity: [],
    }
    const usageByStep = new Map<string, ArenaTokenUsage>()
    let lastFlush = 0
    let progressTail: Promise<void> = Promise.resolve()
    const publish = (): void => {
      const snapshot = structuredClone(progress)
      progressTail = progressTail.then(() => onProgress(snapshot))
    }
    const observe = (notification: HarnessNotification): void => {
      progress.notifications += 1
      if (notification.method === 'session.event') progress.events += 1
      const summary = eventSummary(notification)
      if (summary.toolCall) progress.toolCalls += 1
      if (notification.method === 'session.event') {
        const sample = usageSample(notification.params.event)
        if (sample !== undefined) {
          usageByStep.set(sample.key, sample.usage)
          progress.modelCalls = usageByStep.size
          progress.usage = sumUsage(usageByStep.values())
        }
      }
      progress.lastEvent = summary.kind
      const important = summary.toolCall || summary.kind === 'tool/result'
        || summary.kind === 'session.status' || summary.kind === 'assistant/message'
      const now = Date.now()
      if (important) {
        progress.activity.push({ time: now, kind: summary.kind, detail: summary.detail })
        if (progress.activity.length > this.config.activityLimit) {
          progress.activity.splice(0, progress.activity.length - this.config.activityLimit)
        }
      }
      if (important || now - lastFlush >= this.config.progressFlushMs) {
        lastFlush = now
        publish()
      }
    }

    let rejectAbort!: (error: Error) => void
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const onAbort = (): void => {
      rejectAbort(signal.reason instanceof Error ? signal.reason : new Error('Arena agent cancelled'))
      void harness.close()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const runPromise = harness.session(spec.childSessionId).run(spec.prompt, { onNotification: observe })
    void runPromise.catch(() => {})
    try {
      const result = await Promise.race([runPromise, aborted])
      publish()
      await progressTail
      return {
        finalResponse: result.finalResponse,
        events: result.events.length,
        notifications: result.notifications.length,
        usage: structuredClone(progress.usage),
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      await harness.close()
      await progressTail
    }
  }
}
