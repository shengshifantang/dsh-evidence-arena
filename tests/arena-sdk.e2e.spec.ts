import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import CredentialProvider from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import SandboxProvider from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import { Config, resolveConfig, type ResolvedConfig } from '../src/config.ts'
import { ManagedProcessRunner } from '../src/process-runner.ts'
import { SdkArenaRuntimeRunner } from '../src/runtime.ts'
import { ArenaService } from '../src/service.ts'
import { isActiveArenaStatus, type ArenaRunState } from '../src/types.ts'
import { startMockLlmServer, type MockLlmServer } from './support/llm-mock-server.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const servers: MockLlmServer[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  for (const server of servers.splice(0).reverse()) await server.close()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

async function temporaryDirectory(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-arena-sdk-e2e-${label}-`))
  roots.push(root)
  return root
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function repository(): Promise<string> {
  const root = await temporaryDirectory('repo')
  await git(root, 'init', '--quiet')
  await git(root, 'config', 'user.name', 'Arena SDK E2E')
  await git(root, 'config', 'user.email', 'arena-sdk-e2e@example.invalid')
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: 'arena-sdk-e2e', private: true, type: 'commonjs', scripts: { test: 'node --test' },
  }, null, 2)}\n`)
  await writeFile(join(root, 'result.test.js'), [
    "const { test } = require('node:test')",
    "const assert = require('node:assert/strict')",
    "const { readFileSync } = require('node:fs')",
    "test('candidate creates a testable result', () => {",
    "  assert.match(readFileSync('result.txt', 'utf8'), /^(direct|evidence)\\n$/)",
    "  assert.match(readFileSync('dist/index.html', 'utf8'), /data-arena-candidate/)",
    '})',
    '',
  ].join('\n'))
  await git(root, 'add', 'package.json', 'result.test.js')
  await git(root, 'commit', '--quiet', '-m', 'Initialize SDK Arena E2E fixture')
  return root
}

function builderCommand(candidate: 'direct' | 'evidence'): string {
  const script = [
    "const fs=require('node:fs')",
    "fs.mkdirSync('dist',{recursive:true})",
    `fs.writeFileSync('result.txt',${JSON.stringify(`${candidate}\n`)})`,
    `fs.writeFileSync('dist/index.html',${JSON.stringify(`<!doctype html><main data-arena-candidate>${candidate}</main>\n`)})`,
  ].join(';')
  return `node -e ${JSON.stringify(script)}`
}

async function builderServer(candidate: 'direct' | 'evidence'): Promise<MockLlmServer> {
  const server = await startMockLlmServer({
    sequence: ['tool_call_success', 'success'],
    apiKey: 'fixture-secret',
    toolName: 'bash',
    toolArguments: JSON.stringify({ command: builderCommand(candidate), description: `Create ${candidate} result` }),
    successText: `${candidate} implementation and focused checks completed`,
    chunkDelayMs: 0,
  })
  servers.push(server)
  return server
}

async function reviewerServer(stage: 'logic' | 'security'): Promise<MockLlmServer> {
  const server = await startMockLlmServer({
    sequence: ['success', 'success'],
    repeatLast: true,
    apiKey: 'fixture-secret',
    successText: JSON.stringify({
      verdict: 'approve',
      summary: `${stage} reviewer approved the exact sealed fixture artifact`,
      findings: [],
    }),
    chunkDelayMs: 0,
  })
  servers.push(server)
  return server
}

function profile(baseURL: string, model: string, apiKeyEnv: string) {
  return {
    apiKeyEnv,
    api: 'openai-completions' as const,
    baseURL: `${baseURL}/v1`,
    models: [{ id: model, contextWindow: 32_768, maxTokens: 4_096 }],
  }
}

function route(
  id: string,
  label: string,
  provider: string,
  model: string,
  credential: string,
  family: string,
) {
  return {
    id, label, provider, model,
    credentialEnv: [credential],
    identity: { organization: `${family}-org`, gateway: `${family}-gateway`, modelFamily: family },
    systemPrompt: `Complete the assigned ${label} role and provide exact evidence.`,
  }
}

function config(
  stateRoot: string,
  direct: MockLlmServer,
  evidence: MockLlmServer,
  logic: MockLlmServer,
  security: MockLlmServer,
): ResolvedConfig {
  return resolveConfig(Config({
    stateRoot,
    contenders: [
      route('direct', 'Direct SDK Builder', 'builder-direct', 'direct-model', 'DIRECT_KEY', 'direct-family'),
      route('evidence', 'Evidence SDK Builder', 'builder-evidence', 'evidence-model', 'EVIDENCE_KEY', 'evidence-family'),
    ],
    reviewers: [
      { ...route('logic-review', 'Independent Logic Review', 'reviewer-logic', 'logic-model', 'LOGIC_KEY', 'logic-family'), stage: 'logic', required: true },
      { ...route('security-review', 'Independent Security Review', 'reviewer-security', 'security-model', 'SECURITY_KEY', 'security-family'), stage: 'security', required: true },
    ],
    providerProfiles: {
      'builder-direct': profile(direct.baseURL, 'direct-model', 'DIRECT_KEY'),
      'builder-evidence': profile(evidence.baseURL, 'evidence-model', 'EVIDENCE_KEY'),
      'reviewer-logic': profile(logic.baseURL, 'logic-model', 'LOGIC_KEY'),
      'reviewer-security': profile(security.baseURL, 'security-model', 'SECURITY_KEY'),
    },
    judgeCommands: [{
      id: 'node-test', label: 'Node project tests', stage: 'test', required: true,
      command: process.execPath, args: ['--test'], timeoutMs: 20_000,
    }],
    requireProjectTests: true,
    requireLogicReview: true,
    requireSecurityReview: true,
    reviewerIndependence: 'require',
    requireFullSandbox: true,
    runTimeoutMs: 90_000,
    processGraceMs: 500,
    activePollMs: 10,
    terminalPollMs: 50,
    promotionPreviewTtlMs: 20_000,
    previewStartupTimeoutMs: 10_000,
  } as unknown as Config))
}

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

class FixtureCredentials extends CredentialProvider {
  resolve(_ref: CredentialRef): Promise<ResolvedCredential> {
    return Promise.resolve({ value: 'fixture-secret', source: 'sdk-e2e-fixture' })
  }

  describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: true, source: 'sdk-e2e-fixture', writable: false })
  }

  set(): Promise<void> { return Promise.reject(new Error('fixture credentials are read-only')) }
  unset(): Promise<void> { return Promise.reject(new Error('fixture credentials are read-only')) }
}

async function serviceFor(resolved: ResolvedConfig): Promise<ArenaService> {
  const ctx = new Context()
  const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
  const sandboxFiber = await ctx.plugin(PassthroughSandbox)
  const credentialsFiber = await ctx.plugin(FixtureCredentials)
  const runner = new ManagedProcessRunner(ctx.subprocess, resolved.processGraceMs, ctx.sandbox)
  const service = new ArenaService(
    resolved,
    runner,
    new SdkArenaRuntimeRunner(resolved, ctx.credentials),
    ctx.credentials,
    () => {},
  )
  await service.initialize()
  disposers.push(async () => {
    await service.dispose()
    await credentialsFiber.dispose()
    await sandboxFiber.dispose()
    await subprocessFiber.dispose()
  })
  return service
}

async function terminalRun(service: ArenaService, runId: string): Promise<ArenaRunState> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const state = service.get(runId)
    if (!isActiveArenaStatus(state.status)) return state
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Arena SDK E2E run ${runId} did not reach a terminal state`)
}

async function filesBelow(root: string): Promise<string[]> {
  const result: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else result.push(path)
    }
  }
  await visit(root)
  return result
}

describe('Arena complete DSH SDK path', () => {
  it('runs real child agents, gates, reviewers, evidence, preview, and promotion', async () => {
    const [direct, evidence, logic, security] = await Promise.all([
      builderServer('direct'), builderServer('evidence'), reviewerServer('logic'), reviewerServer('security'),
    ])
    const repo = await repository()
    const stateRoot = await temporaryDirectory('state')
    const resolved = config(stateRoot, direct, evidence, logic, security)
    const service = await serviceFor(resolved)

    const admitted = await service.start({
      workspaceId: 'sdk-e2e-workspace',
      cwd: repo,
      task: 'Create result.txt and a testable static frontend in dist/index.html.',
    })
    const completed = await terminalRun(service, admitted.runId)

    expect(completed.status, completed.error).toBe('completed')
    expect(completed.winner).toBeDefined()
    expect(completed.metrics?.usage.totalTokens).toBeGreaterThan(0)
    expect(completed.metrics?.builders).toBe(2)
    expect(completed.metrics?.reviewers).toBe(4)
    for (const contender of completed.contenders) {
      expect(contender.status, contender.error).toBe('passed')
      expect(contender.progress.toolCalls).toBe(1)
      expect(contender.progress.modelCalls).toBe(2)
      expect(contender.progress.usage.totalTokens).toBeGreaterThan(0)
      expect(contender.evidence?.decision.status).toBe('approved')
      expect(contender.evidence?.changedFiles.map(file => file.path).sort()).toEqual(['dist/index.html', 'result.txt'])
      expect(contender.evidence?.checks.filter(check => check.required).every(check => check.status === 'passed')).toBe(true)
      expect(contender.reviews).toHaveLength(2)
      expect(contender.reviews.every(review => review.status === 'approved' && review.usage.totalTokens > 0)).toBe(true)

      const sessionFiles = (await filesBelow(join(stateRoot, 'runs', completed.runId, 'contenders', contender.id)))
        .filter(path => path.endsWith('.jsonl'))
      expect(sessionFiles.length).toBeGreaterThanOrEqual(3)
      const logs = (await Promise.all(sessionFiles.map(path => readFile(path, 'utf8')))).join('\n')
      expect(logs).toContain('assistant/message')
      expect(logs).not.toContain('fixture-secret')
    }
    expect(direct.requests).toHaveLength(2)
    expect(evidence.requests).toHaveLength(2)
    expect(logic.requests).toHaveLength(2)
    expect(security.requests).toHaveLength(2)

    const started = await service.startCandidatePreview(completed.runId, 'direct', true)
    expect(started.status, started.error).toBe('running')
    expect(await (await fetch(started.url!)).text()).toContain('direct')
    const humanEvaluated = await service.recordHumanEvaluation(
      completed.runId, 'direct', 'passed', 'Loopback preview rendered the expected candidate.', true,
    )
    expect(humanEvaluated.contenders.find(contender => contender.id === 'direct')?.humanEvaluation)
      .toMatchObject({ verdict: 'passed', artifactHash: started.artifactHash })
    expect(humanEvaluated.winner).toEqual(completed.winner)
    expect(service.report(completed.runId).contenders.find(contender => contender.id === 'direct')?.humanEvaluation)
      .toMatchObject({ verdict: 'passed' })
    expect((await service.stopCandidatePreview(completed.runId, 'direct')).status).toBe('stopped')

    const promotion = await service.previewPromotion(completed.runId, 'direct')
    const promoted = await service.confirmPromotion(promotion.token)
    expect(promoted.promotion).toMatchObject({ contenderId: 'direct' })
    expect(await readFile(join(repo, 'result.txt'), 'utf8')).toBe('direct\n')
    expect(await readFile(join(repo, 'dist', 'index.html'), 'utf8')).toContain('data-arena-candidate')
    expect(await git(repo, 'status', '--porcelain=v1', '--untracked-files=all')).toContain('result.txt')
    await service.cleanup(completed.runId)
  }, 120_000)
})
