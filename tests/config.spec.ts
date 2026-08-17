import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.ts'

describe('Arena configuration resolution', () => {
  it('omits the empty runtime override so startup selects the bundled child composition', () => {
    const resolved = resolveConfig(Config({
      stateRoot: join(tmpdir(), 'dsh-arena-config-test'),
    } as Config))

    expect(resolved).not.toHaveProperty('runtimeConfig')
    expect(resolveConfig(Config({ stateRoot: '' } as Config)).stateRoot.replaceAll('\\', '/')).toContain('/arena/v4')
  })

  it('retains an explicit runtime override as an absolute path', () => {
    const resolved = resolveConfig(Config({
      stateRoot: join(tmpdir(), 'dsh-arena-config-test'),
      runtimeConfig: './fixtures/runtime.yml',
    } as Config))

    expect(resolved.runtimeConfig).toBeDefined()
    expect(isAbsolute(resolved.runtimeConfig!)).toBe(true)
  })

  it('validates credential references at each agent boundary without a second global allowlist', () => {
    const config = Config({ stateRoot: join(tmpdir(), 'dsh-arena-config-test') } as Config)
    config.contenders[0]!.credentialEnv = ['DIRECT_API_KEY', 'DIRECT_API_KEY']
    expect(() => resolveConfig(config)).toThrow('credential DIRECT_API_KEY is duplicated')

    config.contenders[0]!.credentialEnv = ['not-a-valid-reference']
    expect(() => resolveConfig(config)).toThrow('credential "not-a-valid-reference" is invalid')
  })

  it('refuses runtime environment values that collide with credential references', () => {
    const config = Config({ stateRoot: join(tmpdir(), 'dsh-arena-config-test') } as Config)
    for (const agent of [...config.contenders, ...config.reviewers]) agent.credentialEnv = ['CRED']
    config.runtimeEnv = { CRED: 'must-not-shadow-the-credential-service' }
    expect(() => resolveConfig(config)).toThrow('cannot override credential reference CRED')
  })

  it('keeps project policy as arbitrary argv rather than a language-specific preset', () => {
    const config = Config({
      stateRoot: join(tmpdir(), 'dsh-arena-config-test'),
      judgeCommands: [{
        id: 'python-tests', label: 'Python tests', stage: 'test', required: true,
        command: 'python3', args: ['-m', 'pytest', '-q'], timeoutMs: 90_000,
      }],
    } as Config)

    expect(resolveConfig(config).judgeCommands[0]).toMatchObject({
      command: 'python3', args: ['-m', 'pytest', '-q'],
    })
  })

  it('rejects insecure remote provider endpoints and undeclared explicit models', () => {
    const config = Config({ stateRoot: join(tmpdir(), 'dsh-arena-config-test') } as Config)
    config.providerProfiles.acme = {
      apiKeyEnv: 'ACME_API_KEY',
      api: 'openai-completions',
      baseURL: 'http://api.acme.example/v1',
      models: [{ id: 'acme-safe' }],
    }
    config.contenders[0] = {
      ...config.contenders[0]!, provider: 'acme', model: 'acme-missing', credentialEnv: ['ACME_API_KEY'],
    }
    expect(() => resolveConfig(config)).toThrow('must use HTTPS unless it is loopback')

    config.providerProfiles.acme.baseURL = 'https://api.acme.example/v1'
    expect(() => resolveConfig(config)).toThrow('model acme-missing is not declared')
  })

  it('rejects portable-path escapes and invalid whole-run budget bounds', () => {
    const config = Config({ stateRoot: join(tmpdir(), 'dsh-arena-config-test') } as Config)
    config.policyPackPath = 'C:\\outside\\arena-policy.json'
    expect(() => resolveConfig(config)).toThrow('repository-relative path')

    config.policyPackPath = '.dsh/arena-policy.json'
    config.maxRunTokens = -1
    expect(() => resolveConfig(config)).toThrow('maxRunTokens must be a non-negative safe integer')

    config.maxRunTokens = 0
    config.stopAfterApproved = config.contenders.length + 1
    expect(() => resolveConfig(config)).toThrow('cannot exceed the contender count')

    config.stopAfterApproved = 0
    config.runTimeoutMs = 2_147_483_648
    expect(() => resolveConfig(config)).toThrow('portable Node.js timer limit')
  })
})
