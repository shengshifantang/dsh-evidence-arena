/** Deterministic base-commit context materialized once and reused by every Builder prompt. */

import { createHash } from 'node:crypto'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { ResolvedConfig } from './config.ts'
import type { ArenaGit, ArenaRepository } from './git.ts'
import type { ArenaContenderConfig, ArenaProjectPolicyRules, ArenaSharedContext } from './types.ts'

function bytes(value: string): number {
  return Buffer.byteLength(value)
}

function cacheEligible(contenders: readonly ArenaContenderConfig[]): string[] {
  const counts = new Map<string, number>()
  for (const contender of contenders) {
    const key = `${contender.provider}\0${contender.model}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return contenders
    .filter(contender => (counts.get(`${contender.provider}\0${contender.model}`) ?? 0) > 1)
    .map(contender => contender.id)
}

/** Build and persist the complete shared prefix without exceeding its byte budget. */
export async function buildSharedContext(
  git: ArenaGit,
  repo: ArenaRepository,
  policy: ArenaProjectPolicyRules,
  config: ResolvedConfig,
  target: string,
  signal: AbortSignal,
): Promise<{ facts: ArenaSharedContext; text: string }> {
  const allFiles = await git.listBaseFiles(repo, signal)
  const fileSet = new Set(allFiles)
  for (const path of policy.sharedContextPaths) {
    if (!fileSet.has(path)) throw new Error(`shared context path does not exist at the immutable base: ${path}`)
  }

  const sections = [
    'ARENA_SHARED_CONTEXT_V1',
    `Base commit: ${repo.baseCommit}`,
    'This block is read-only repository evidence shared verbatim across Builder requests.',
  ]
  for (const path of policy.sharedContextPaths) {
    const remaining = config.maxSharedContextBytes - bytes(`${sections.join('\n\n')}\n\n# File: ${path}\n`)
    if (remaining <= 0) throw new Error(`shared context metadata exceeds maxSharedContextBytes (${config.maxSharedContextBytes})`)
    const text = await git.readBaseFile(repo, path, remaining, signal)
    sections.push(`# File: ${path}\n${text}`)
  }

  const indexed = allFiles.slice(0, config.maxSharedContextFiles)
  const indexHeader = `# Repository file index (${allFiles.length} total)`
  const withoutIndex = sections.join('\n\n')
  let index = bytes(`${withoutIndex}\n\n${indexHeader}\n`) <= config.maxSharedContextBytes ? indexHeader : ''
  let indexedFiles = 0
  for (const path of index.length === 0 ? [] : indexed) {
    const candidate = `${withoutIndex}\n\n${index}\n${path}\n`
    if (bytes(candidate) > config.maxSharedContextBytes) break
    index += `\n${path}`
    indexedFiles += 1
  }
  if (index.length > 0) sections.push(index)
  const text = `${sections.join('\n\n')}\n`
  if (bytes(text) > config.maxSharedContextBytes) {
    throw new Error(`shared context exceeds maxSharedContextBytes (${config.maxSharedContextBytes})`)
  }
  await writeFileAtomic(target, text, { mode: 0o600, dirMode: 0o700 })
  return {
    text,
    facts: {
      artifactHash: createHash('sha256').update(text).digest('hex'),
      bytes: bytes(text),
      indexedFiles,
      includedPaths: [...policy.sharedContextPaths],
      truncatedIndex: indexedFiles < allFiles.length,
      cacheEligibleContenders: cacheEligible(config.contenders),
    },
  }
}
