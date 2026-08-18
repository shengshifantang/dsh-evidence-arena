import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockLlmServer, type MockLlmServer } from './support/llm-mock-server.ts'
import { Config, resolveConfig, type ResolvedConfig } from '../src/config.ts'
import { SdkArenaRuntimeRunner, validateRuntimeAssets, type ArenaRuntimeSpec } from '../src/runtime.ts'

const roots: string[] = []
const servers: MockLlmServer[] = []

afterEach(async () => {
  for (const server of servers.splice(0).reverse()) await server.close()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

async function workspace(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-arena-runtime-${label}-`))
  roots.push(root)
  await writeFile(join(root, 'README.md'), '# Runtime fixture\n')
  return root
}

function credentials(values: Readonly<Record<string, string>>): {
  provider: CredentialProvider
  resolvedRefs: CredentialRef[]
} {
  const resolvedRefs: CredentialRef[] = []
  const provider = {
    resolve: async (ref: CredentialRef) => {
      resolvedRefs.push(ref)
      const value = values[String(ref)]
      return value === undefined ? undefined : { value, source: 'integration-fixture' }
    },
    describe: async (ref: CredentialRef) => ({
      configured: values[String(ref)] !== undefined,
      source: values[String(ref)] === undefined ? undefined : 'integration-fixture',
      writable: false,
    }),
    set: async () => { throw new Error('read-only fixture') },
    unset: async () => { throw new Error('read-only fixture') },
  } as unknown as CredentialProvider
  return { provider, resolvedRefs }
}

function spec(
  root: string,
  agent: ArenaRuntimeSpec['agent'],
  id: string,
  role: ArenaRuntimeSpec['role'] = 'reviewer',
): ArenaRuntimeSpec {
  return {
    runId: `run-${id}`,
    role,
    agentId: id,
    agent,
    systemPrompt: agent.systemPrompt,
    prompt: 'Reply with the fixture answer and do not call tools.',
    worktreePath: root,
    childSessionId: `session-${id}`,
    childSessionRoot: join(root, '.sessions', id),
    permissionMode: role === 'reviewer' ? 'read-only' : 'workspace-write',
  }
}

async function run(config: ResolvedConfig, provider: CredentialProvider, request: ArenaRuntimeSpec) {
  await validateRuntimeAssets(config)
  await mkdir(request.childSessionRoot, { recursive: true })
  const snapshots: unknown[] = []
  const result = await new SdkArenaRuntimeRunner(config, provider).run(
    request,
    async (progress) => { snapshots.push(progress) },
    new AbortController().signal,
  )
  return { result, snapshots }
}

describe('Arena SDK provider integration', () => {
  it('calls the native DeepSeek adapter with only its resolved credential', async () => {
    const server = await startMockLlmServer({
      sequence: ['success'],
      apiKey: 'native-fixture-secret',
      successText: 'native-ready',
      chunkDelayMs: 0,
    })
    servers.push(server)
    const root = await workspace('native')
    const config = resolveConfig(Config({
      stateRoot: join(root, '.arena'),
      reviewers: [],
      requireProjectTests: false,
      requireLogicReview: false,
      requireSecurityReview: false,
      runtimeEnv: { DEEPSEEK_BASE_URL: server.baseURL },
    } as unknown as Config))
    const fixture = credentials({ DEEPSEEK_API_KEY: 'native-fixture-secret' })
    const { result, snapshots } = await run(config, fixture.provider, spec(root, {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      systemPrompt: 'Native integration fixture.',
      credentialEnv: ['DEEPSEEK_API_KEY'],
    }, 'native'))

    expect(result.finalResponse).toContain('native-ready')
    expect(snapshots.length).toBeGreaterThan(0)
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.path).toBe('/chat/completions')
    expect(server.requests[0]?.headers.authorization).toBe('Bearer native-fixture-secret')
    expect(server.requests[0]?.body).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
    })
    expect(server.requests[0]?.body).not.toHaveProperty('reasoning_effort')
    expect(server.requests[0]?.body).not.toHaveProperty('tools')
    expect(JSON.stringify(server.requests[0]?.body)).not.toContain('Runtime fixture')
    expect(fixture.resolvedRefs.map(String)).toEqual(['DEEPSEEK_API_KEY'])
  }, 30_000)

  it('calls a hand-declared OpenAI-compatible provider with its own key reference', async () => {
    const server = await startMockLlmServer({
      sequence: ['success'],
      apiKey: 'gateway-fixture-secret',
      successText: 'gateway-ready',
      chunkDelayMs: 0,
    })
    servers.push(server)
    const root = await workspace('gateway')
    const raw = Config({
      stateRoot: join(root, '.arena'),
      reviewers: [],
      requireProjectTests: false,
      requireLogicReview: false,
      requireSecurityReview: false,
    } as unknown as Config)
    raw.providerProfiles['mock-gateway'] = {
      apiKeyEnv: 'MOCK_GATEWAY_API_KEY',
      displayName: 'Mock Gateway',
      api: 'openai-completions',
      baseURL: `${server.baseURL}/v1`,
      models: [{ id: 'mock-model', contextWindow: 8_192, maxTokens: 1_024 }],
    }
    raw.contenders[0] = {
      ...raw.contenders[0]!,
      provider: 'mock-gateway',
      model: 'mock-model',
      credentialEnv: ['MOCK_GATEWAY_API_KEY'],
    }
    const config = resolveConfig(raw)
    const fixture = credentials({ MOCK_GATEWAY_API_KEY: 'gateway-fixture-secret' })
    const parentProfile = join(root, 'sensitive-host-profile')
    const previousDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = parentProfile
    let result: Awaited<ReturnType<typeof run>>['result']
    try {
      ;({ result } = await run(config, fixture.provider, spec(root, raw.contenders[0], 'gateway', 'builder')))
    } finally {
      if (previousDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousDshHome
    }

    expect(result.finalResponse).toContain('gateway-ready')
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.path).toBe('/v1/chat/completions')
    expect(server.requests[0]?.headers.authorization).toBe('Bearer gateway-fixture-secret')
    expect(server.requests[0]?.body).toMatchObject({ model: 'mock-model' })
    const request = JSON.stringify(server.requests[0]?.body)
    expect(request).toContain('"name":"glob"')
    expect(request).toContain('"name":"grep"')
    expect(request).toContain('"name":"str_replace_editor"')
    expect(request).toContain('"name":"subagent"')
    expect(request).not.toContain(parentProfile)
    expect(fixture.resolvedRefs.map(String)).toEqual(['MOCK_GATEWAY_API_KEY'])
  }, 30_000)
})
