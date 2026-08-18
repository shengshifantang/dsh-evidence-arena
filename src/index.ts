/** Evidence Arena Host plugin: Workspace-owned RPC workbench and orchestration service. */

import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace'
import { Config, resolveConfig } from './config.ts'
import { ManagedProcessRunner } from './process-runner.ts'
import { SdkArenaRuntimeRunner, validateRuntimeAssets } from './runtime.ts'
import { ArenaService } from './service.ts'

export { Config }
export type { Config as ArenaConfig } from './config.ts'
export type * from './types.ts'
export { ArenaService } from './service.ts'

export const name = 'arena'
export const inject = ['connection', 'subprocess', 'sandbox', 'credentials', 'workspaceRegistry']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-owned Evidence Arena service. */
    arena: ArenaService
  }
}

function recordPayload(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function requiredString(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function badRequest(message: string) {
  return { ok: false as const, error: { code: 'bad-request' as const, message, details: { issues: [] } } }
}

function commandError(error: unknown) {
  return {
    ok: false as const,
    error: { code: 'command-error' as const, message: error instanceof Error ? error.message : String(error), details: {} },
  }
}

function workspaceTarget(ctx: Context, workspaceId: string): { workspaceId: string; cwd: string } {
  const workspace = ctx.workspaceRegistry.get(workspaceId as WorkspaceId)
  if (workspace === undefined) throw new Error(`Arena workspace not found: ${workspaceId}`)
  return { workspaceId, cwd: workspace.path }
}

async function handleReadRequest(ctx: Context, service: ArenaService, endpoint: string, rawPayload: unknown) {
  const payload = recordPayload(rawPayload)
  try {
    if (endpoint === 'run') {
      const runId = requiredString(payload, 'runId')
      if (runId === undefined) return badRequest('runId is required')
      return { ok: true as const, value: service.response(service.get(runId)) }
    }
    if (endpoint === 'report') {
      const runId = requiredString(payload, 'runId')
      if (runId === undefined) return badRequest('runId is required')
      return { ok: true as const, value: service.report(runId) }
    }
    if (endpoint === 'setup') {
      const workspaceId = requiredString(payload, 'workspaceId')
      if (workspaceId === undefined) return badRequest('workspaceId is required')
      const target = workspaceTarget(ctx, workspaceId)
      return { ok: true as const, value: await service.prepareSetup(target.workspaceId, target.cwd) }
    }
    if (endpoint === 'candidate-file-diff') {
      const runId = requiredString(payload, 'runId')
      const contenderId = requiredString(payload, 'contenderId')
      const path = requiredString(payload, 'path')
      if (runId === undefined || contenderId === undefined || path === undefined) {
        return badRequest('runId, contenderId, and path are required')
      }
      return { ok: true as const, value: await service.candidateFileDiff(runId, contenderId, path) }
    }
    if (endpoint === 'candidate-preview') {
      const runId = requiredString(payload, 'runId')
      const contenderId = requiredString(payload, 'contenderId')
      if (runId === undefined || contenderId === undefined) return badRequest('runId and contenderId are required')
      return { ok: true as const, value: service.candidatePreviewStatus(runId, contenderId) }
    }
    if (endpoint === 'list') return { ok: true as const, value: service.list() }
    return badRequest(`unknown Arena read endpoint: ${endpoint}`)
  } catch (error) {
    return commandError(error)
  }
}

/** Register the stock-DSH-compatible read and loopback-control surfaces. */
export function registerArenaSurfaces(ctx: Context, service: ArenaService): void {
  const connection = ctx.get('connection') as HostConnectionHandle
  ctx.effect(() => async () => { await service.dispose() }, 'arena: child runtime lifecycle')

  ctx.effect(() => connection.rpc.handle(
    '/arena-read',
    (endpoint, rawPayload) => handleReadRequest(ctx, service, endpoint, rawPayload),
    { authority: 'trusted-host' },
  ), 'arena: trusted read RPC')

  ctx.effect(() => connection.rpc.handle('/arena-control', async (endpoint, rawPayload) => {
    const payload = recordPayload(rawPayload)
    try {
      if (endpoint === 'start') {
        const workspaceId = requiredString(payload, 'workspaceId')
        const task = requiredString(payload, 'task')
        if (workspaceId === undefined || task === undefined) return badRequest('workspaceId and task are required')
        const target = workspaceTarget(ctx, workspaceId)
        return {
          ok: true,
          value: service.response(await service.start({
            ...target,
            task,
            acknowledgeUnlimitedBudget: payload?.acknowledgeUnlimitedBudget === true,
          })),
        }
      }
      if (endpoint === 'demo-create') {
        return { ok: true, value: await service.createDemoProject() }
      }
      if (endpoint === 'retry') {
        const runId = requiredString(payload, 'runId')
        if (runId === undefined) return badRequest('runId is required')
        const original = service.get(runId)
        const target = workspaceTarget(ctx, original.workspaceId)
        return {
          ok: true,
          value: service.response(await service.retry(runId, {
            ...target,
            acknowledgeUnlimitedBudget: payload?.acknowledgeUnlimitedBudget === true,
          })),
        }
      }
      if (endpoint === 'cancel' || endpoint === 'cleanup') {
        const runId = requiredString(payload, 'runId')
        if (runId === undefined) return badRequest('runId is required')
        const run = endpoint === 'cancel' ? await service.cancel(runId) : await service.cleanup(runId)
        return { ok: true, value: service.response(run) }
      }
      if (endpoint === 'promotion-preview') {
        const runId = requiredString(payload, 'runId')
        const contenderId = requiredString(payload, 'contenderId')
        if (runId === undefined || contenderId === undefined) return badRequest('runId and contenderId are required')
        return { ok: true, value: await service.previewPromotion(runId, contenderId) }
      }
      if (endpoint === 'promotion-confirm') {
        const token = requiredString(payload, 'token')
        if (token === undefined) return badRequest('token is required')
        return { ok: true, value: service.response(await service.confirmPromotion(token)) }
      }
      if (endpoint === 'candidate-preview-start') {
        const runId = requiredString(payload, 'runId')
        const contenderId = requiredString(payload, 'contenderId')
        if (runId === undefined || contenderId === undefined || payload?.acknowledged !== true) {
          return badRequest('runId, contenderId, and acknowledged=true are required')
        }
        return { ok: true, value: await service.startCandidatePreview(runId, contenderId, true) }
      }
      if (endpoint === 'candidate-preview-stop') {
        const runId = requiredString(payload, 'runId')
        const contenderId = requiredString(payload, 'contenderId')
        if (runId === undefined || contenderId === undefined) return badRequest('runId and contenderId are required')
        return { ok: true, value: await service.stopCandidatePreview(runId, contenderId) }
      }
      if (endpoint === 'human-evaluation') {
        const runId = requiredString(payload, 'runId')
        const contenderId = requiredString(payload, 'contenderId')
        const verdict = requiredString(payload, 'verdict')
        const note = payload?.note
        if (runId === undefined || contenderId === undefined || verdict === undefined || payload?.acknowledged !== true) {
          return badRequest('runId, contenderId, verdict, and acknowledged=true are required')
        }
        if (!['passed', 'failed', 'inconclusive'].includes(verdict)) return badRequest('verdict is invalid')
        if (note !== undefined && typeof note !== 'string') return badRequest('note must be a string')
        const run = await service.recordHumanEvaluation(
          runId,
          contenderId,
          verdict as 'passed' | 'failed' | 'inconclusive',
          note,
          true,
        )
        return { ok: true, value: service.response(run) }
      }
      if (endpoint === 'policy-write') {
        const workspaceId = requiredString(payload, 'workspaceId')
        const policyText = requiredString(payload, 'policyText')
        if (workspaceId === undefined || policyText === undefined) {
          return badRequest('workspaceId and policyText are required')
        }
        const target = workspaceTarget(ctx, workspaceId)
        if (await service.setupForWorkspace(workspaceId) === undefined) {
          await service.prepareSetup(target.workspaceId, target.cwd)
        }
        return { ok: true, value: await service.writeSetupPolicy(workspaceId, policyText) }
      }
      return badRequest(`unknown Arena control endpoint: ${endpoint}`)
    } catch (error) {
      return commandError(error)
    }
  }, { authority: 'loopback' }), 'arena: loopback control RPC')
}

/** Compose the owned service and stock-DSH-compatible Workspace workbench transport. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)
  await validateRuntimeAssets(resolved)
  const processRunner = new ManagedProcessRunner(ctx.subprocess, resolved.processGraceMs, ctx.sandbox)
  const service = new ArenaService(
    resolved,
    processRunner,
    new SdkArenaRuntimeRunner(resolved, ctx.credentials),
    ctx.credentials,
    (message) => { ctx.logger.warn(message) },
  )
  await service.initialize()
  ctx.provide('arena', service)
  registerArenaSurfaces(ctx, service)
}
