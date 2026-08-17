import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, hostProjectPolicy, resolveConfig } from '../src/config.ts'
import { buildSharedContext } from '../src/context-cache.ts'
import type { ArenaGit, ArenaRepository } from '../src/git.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

describe('shared immutable Builder context', () => {
  it('materializes one bounded base-commit artifact with an identical cache-eligible prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arena-context-'))
    roots.push(root)
    const config = resolveConfig(Config({
      stateRoot: join(root, '.state'),
      sharedContextPaths: ['AGENTS.md'],
      maxSharedContextBytes: 2_000,
      maxSharedContextFiles: 2,
      contenders: [
        {
          id: 'one', label: 'One', provider: 'fixture', model: 'same', systemPrompt: 'one',
          credentialEnv: ['FIXTURE_API_KEY'],
        },
        {
          id: 'two', label: 'Two', provider: 'fixture', model: 'same', systemPrompt: 'two',
          credentialEnv: ['FIXTURE_API_KEY'],
        },
      ],
      providerProfiles: {
        fixture: { apiKeyEnv: 'FIXTURE_API_KEY', models: [{ id: 'same' }] },
      },
    } as never))
    const readBaseFile = vi.fn(async () => 'Repository instructions\n')
    const git = {
      listBaseFiles: vi.fn(async () => ['AGENTS.md', 'src/a.ts', 'src/b.ts']),
      readBaseFile,
    } as unknown as ArenaGit
    const repo: ArenaRepository = { root, baseCommit: 'a'.repeat(40) }
    const target = join(root, 'shared.txt')
    const built = await buildSharedContext(
      git,
      repo,
      hostProjectPolicy(config),
      config,
      target,
      new AbortController().signal,
    )

    expect(await readFile(target, 'utf8')).toBe(built.text)
    expect(built.text).toContain(`Base commit: ${repo.baseCommit}`)
    expect(built.text).toContain('# File: AGENTS.md\nRepository instructions')
    expect(built.facts).toMatchObject({
      bytes: Buffer.byteLength(built.text),
      indexedFiles: 2,
      includedPaths: ['AGENTS.md'],
      truncatedIndex: true,
      cacheEligibleContenders: ['one', 'two'],
    })
    expect(readBaseFile).toHaveBeenCalledOnce()
  })

  it('omits the optional index header when explicit context consumes the remaining bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arena-context-tight-'))
    roots.push(root)
    const base = resolveConfig(Config({
      stateRoot: join(root, '.state'), sharedContextPaths: ['A.md'], maxSharedContextBytes: 1_000,
    } as never))
    const git = {
      listBaseFiles: vi.fn(async () => ['A.md']),
      readBaseFile: vi.fn(async (_repo, _path, remaining: number) => 'x'.repeat(Math.max(0, remaining - 1))),
    } as unknown as ArenaGit
    const result = await buildSharedContext(
      git,
      { root, baseCommit: 'b'.repeat(40) },
      hostProjectPolicy(base),
      base,
      join(root, 'tight.txt'),
      new AbortController().signal,
    )
    expect(result.facts.bytes).toBeLessThanOrEqual(base.maxSharedContextBytes)
  })
})
