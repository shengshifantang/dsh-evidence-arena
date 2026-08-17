/** Git worktree isolation, evidence capture, and exact patch application primitives. */

import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { ResolvedConfig } from './config.ts'
import type { ManagedProcessRunner, ProcessResult } from './process-runner.ts'
import type { ArenaChangedFile, ArenaEvidence } from './types.ts'
import {
  assertRepositoryContainment,
  normalizeRepositoryPath,
  repositoryAbsolutePath,
  sameNativePath,
} from './repository-path.ts'

/** Stored manifest entry for one captured untracked regular file. */
export interface ArenaUntrackedArtifact {
  path: string
  size: number
  sha256: string
  mode: number
}

/** Complete promotion source captured after the child runtime exits. */
export interface CapturedCandidate {
  headCommit: string
  patch: string
  untracked: ArenaUntrackedArtifact[]
  evidence: Pick<
    ArenaEvidence,
    | 'patchHash'
    | 'patchBytes'
    | 'untrackedBytes'
    | 'changedFiles'
    | 'addedLines'
    | 'deletedLines'
    | 'diffPreview'
    | 'diffPreviewTruncated'
  >
}

/** Immutable repository admission facts. */
export interface ArenaRepository {
  root: string
  baseCommit: string
}

/** Repository facts that preflight can report before clean admission. */
export interface ArenaRepositoryInspection extends ArenaRepository {
  clean: boolean
}

function errorText(result: ProcessResult): string {
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(-4_000)
  return detail.length === 0 ? `exit ${String(result.exitCode)}${result.signal === null ? '' : ` (${result.signal})`}` : detail
}

function assertCompleteOutput(label: string, result: ProcessResult): void {
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error(`dsh-arena ${label} exceeded its configured output bound`)
  }
}

function safeRelativePath(root: string, candidate: string): string {
  const path = normalizeRepositoryPath(candidate)
  repositoryAbsolutePath(root, path)
  return path
}

function parseNameStatus(output: string): Map<string, string> {
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()
  const result = new Map<string, string>()
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    const first = fields[index++]
    if (status === undefined || first === undefined) throw new Error('malformed git --name-status -z output')
    if (status.startsWith('R') || status.startsWith('C')) {
      const target = fields[index++]
      if (target === undefined) throw new Error('malformed rename/copy record')
      result.set(target, status)
    } else {
      result.set(first, status)
    }
  }
  return result
}

interface NumstatRow {
  added: number
  deleted: number
  binary: boolean
}

function parseCount(raw: string): { count: number; binary: boolean } {
  if (raw === '-') return { count: 0, binary: true }
  const count = Number(raw)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`malformed git numstat count ${JSON.stringify(raw)}`)
  return { count, binary: false }
}

function parseNumstat(output: string): Map<string, NumstatRow> {
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()
  const rows = new Map<string, NumstatRow>()
  for (let index = 0; index < fields.length;) {
    const header = fields[index++]
    if (header === undefined) break
    const firstTab = header.indexOf('\t')
    const secondTab = header.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) throw new Error('malformed git --numstat -z output')
    const added = parseCount(header.slice(0, firstTab))
    const deleted = parseCount(header.slice(firstTab + 1, secondTab))
    let path = header.slice(secondTab + 1)
    if (path.length === 0) {
      const _source = fields[index++]
      const target = fields[index++]
      if (_source === undefined || target === undefined) throw new Error('malformed numstat rename/copy record')
      path = target
    }
    rows.set(path, {
      added: added.count,
      deleted: deleted.count,
      binary: added.binary || deleted.binary,
    })
  }
  return rows
}

/** All Git calls are argv-only and bounded through the managed subprocess seam. */
export class ArenaGit {
  constructor(
    private readonly runner: ManagedProcessRunner,
    private readonly config: ResolvedConfig,
  ) {}

  /** Inspect a non-bare repository without requiring a clean working tree. */
  async inspect(cwd: string, signal?: AbortSignal): Promise<ArenaRepositoryInspection> {
    const root = (await this.git(cwd, ['rev-parse', '--show-toplevel'], signal)).stdout.trim()
    if (root.length === 0) throw new Error(`${cwd} is not inside a Git worktree`)
    const bare = (await this.git(root, ['rev-parse', '--is-bare-repository'], signal)).stdout.trim()
    if (bare !== 'false') throw new Error(`dsh-arena requires a non-bare Git worktree: ${root}`)
    const status = await this.git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal)
    const baseCommit = (await this.git(root, ['rev-parse', '--verify', 'HEAD'], signal)).stdout.trim()
    if (!/^[0-9a-f]{40,64}$/u.test(baseCommit)) throw new Error(`Git returned an invalid HEAD object id: ${baseCommit}`)
    return { root, baseCommit, clean: status.stdout.length === 0 }
  }

  /** Admit only a non-bare clean repository and freeze its current HEAD. */
  async discover(cwd: string, signal?: AbortSignal): Promise<ArenaRepository> {
    const inspected = await this.inspect(cwd, signal)
    if (!inspected.clean) {
      throw new Error('dsh-arena requires the original Git worktree to be clean, including untracked files')
    }
    return { root: inspected.root, baseCommit: inspected.baseCommit }
  }

  /** Create and lock a detached worktree so ordinary pruning cannot erase live work. */
  async createWorktree(repo: ArenaRepository, path: string, runId: string, signal: AbortSignal): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await this.git(repo.root, ['worktree', 'add', '--detach', path, repo.baseCommit], signal)
    try {
      await this.git(repo.root, ['worktree', 'lock', '--reason', `dsh-arena ${runId}`, path], signal)
    } catch (error) {
      await this.gitAllowFailure(repo.root, ['worktree', 'remove', '--force', path], signal)
      throw error
    }
  }

  /** Reuse an exact registered worktree after restart, or create it when no path exists. */
  async ensureWorktree(
    repo: ArenaRepository,
    path: string,
    runId: string,
    signal: AbortSignal,
  ): Promise<'created' | 'reused'> {
    const listed = await this.git(repo.root, ['worktree', 'list', '--porcelain', '-z'], signal)
    const records: Array<{ path: string; head?: string }> = []
    let current: { path: string; head?: string } | undefined
    for (const field of listed.stdout.split('\0')) {
      if (field.startsWith('worktree ')) {
        current = { path: field.slice('worktree '.length) }
        records.push(current)
      } else if (field.startsWith('HEAD ')) {
        if (current !== undefined) current.head = field.slice('HEAD '.length)
      }
    }
    let registered: { path: string; head?: string } | undefined
    for (const record of records) {
      let matches = sameNativePath(record.path, path)
      if (!matches) {
        try {
          const [listedReal, expectedReal] = await Promise.all([realpath(record.path), realpath(path)])
          matches = sameNativePath(listedReal, expectedReal)
        } catch { /* a missing candidate cannot be the registered existing worktree */ }
      }
      if (matches) {
        registered = record
        break
      }
    }
    if (registered !== undefined) {
      if (registered.head !== repo.baseCommit) {
        throw new Error(`recovered worktree ${path} is at ${registered.head ?? '<unknown>'}, expected ${repo.baseCommit}`)
      }
      const lock = await this.gitAllowFailure(repo.root, ['worktree', 'lock', '--reason', `dsh-arena ${runId}`, path], signal)
      if (lock.exitCode !== 0 && !/already locked/iu.test(`${lock.stdout}\n${lock.stderr}`)) {
        throw new Error(`git worktree lock failed: ${errorText(lock)}`)
      }
      return 'reused'
    }
    try {
      await lstat(path)
      throw new Error(`recovery path exists but is not a registered Git worktree: ${path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await this.createWorktree(repo, path, runId, signal)
    return 'created'
  }

  /** List every path in the immutable base tree using Git's portable separators. */
  async listBaseFiles(repo: ArenaRepository, signal: AbortSignal): Promise<string[]> {
    const result = await this.git(
      repo.root,
      ['ls-tree', '-r', '--name-only', '-z', repo.baseCommit],
      signal,
      this.config.maxOutputBytes * 16,
    )
    return result.stdout.split('\0').filter(Boolean).map(normalizeRepositoryPath).sort()
  }

  /** Read one explicit text file from the immutable base without consulting a contender worktree. */
  async readBaseFile(
    repo: ArenaRepository,
    path: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<string> {
    const portable = normalizeRepositoryPath(path)
    const result = await this.git(repo.root, ['show', `${repo.baseCommit}:${portable}`], signal, maxBytes + 1)
    if (result.stdoutTruncated || Buffer.byteLength(result.stdout) > maxBytes) {
      throw new Error(`shared context file exceeds the remaining byte budget: ${portable}`)
    }
    if (result.stdout.includes('\0')) throw new Error(`shared context file is binary: ${portable}`)
    return result.stdout
  }

  /** Explicit, recoverable cleanup: evidence is already copied outside the worktree. */
  async removeWorktree(repoRoot: string, path: string, signal?: AbortSignal): Promise<void> {
    await this.gitAllowFailure(repoRoot, ['worktree', 'unlock', path], signal)
    const removed = await this.gitAllowFailure(repoRoot, ['worktree', 'remove', '--force', path], signal)
    if (removed.exitCode !== 0 && !/not a working tree|does not exist|missing/u.test(`${removed.stderr}\n${removed.stdout}`)) {
      throw new Error(`git worktree remove failed: ${errorText(removed)}`)
    }
    await this.gitAllowFailure(repoRoot, ['worktree', 'prune'], signal)
  }

  /** Capture tracked binary patch plus byte-exact copies of every untracked regular file. */
  async capture(
    repo: ArenaRepository,
    worktreePath: string,
    artifactDir: string,
    signal: AbortSignal,
  ): Promise<CapturedCandidate> {
    await mkdir(artifactDir, { recursive: true, mode: 0o700 })
    const headCommit = (await this.git(worktreePath, ['rev-parse', '--verify', 'HEAD'], signal)).stdout.trim()
    const patchResult = await this.git(
      worktreePath,
      ['diff', '--binary', '--no-ext-diff', '--full-index', repo.baseCommit, '--'],
      signal,
      this.config.maxPatchBytes + 1,
    )
    if (patchResult.stdoutTruncated || Buffer.byteLength(patchResult.stdout) > this.config.maxPatchBytes) {
      throw new Error(`tracked patch exceeds maxPatchBytes (${this.config.maxPatchBytes})`)
    }
    const patch = patchResult.stdout
    await writeFileAtomic(resolve(artifactDir, 'changes.patch'), patch, { mode: 0o600, dirMode: 0o700 })

    const [names, stats, untrackedResult] = await Promise.all([
      this.git(worktreePath, ['diff', '--name-status', '-z', repo.baseCommit, '--'], signal),
      this.git(worktreePath, ['diff', '--numstat', '-z', repo.baseCommit, '--'], signal),
      this.git(worktreePath, ['ls-files', '--others', '--exclude-standard', '-z'], signal),
    ])
    const statuses = parseNameStatus(names.stdout)
    const numbers = parseNumstat(stats.stdout)
    const changedFiles: ArenaChangedFile[] = []
    for (const [path, status] of statuses) {
      const safePath = safeRelativePath(worktreePath, path)
      const row = numbers.get(path) ?? { added: 0, deleted: 0, binary: true }
      changedFiles.push({
        path: safePath,
        status,
        added: row.added,
        deleted: row.deleted,
        binary: row.binary,
        untracked: false,
      })
    }

    const untrackedPaths = untrackedResult.stdout.split('\0').filter(path => path.length > 0).sort()
    const untracked: ArenaUntrackedArtifact[] = []
    let untrackedBytes = 0
    for (const rawPath of untrackedPaths) {
      const path = safeRelativePath(worktreePath, rawPath)
      const source = repositoryAbsolutePath(worktreePath, path)
      await assertRepositoryContainment(worktreePath, source)
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
      const handle = await open(source, fsConstants.O_RDONLY | noFollow)
      let info
      let bytes: Buffer
      try {
        info = await handle.stat()
        if (!info.isFile()) throw new Error(`untracked path is not a regular file and cannot be promoted safely: ${path}`)
        bytes = await handle.readFile()
      } finally {
        await handle.close()
      }
      if (bytes.byteLength !== info.size) throw new Error(`untracked file changed while it was being captured: ${path}`)
      untrackedBytes += bytes.byteLength
      if (untrackedBytes > this.config.maxUntrackedBytes) {
        throw new Error(`untracked files exceed maxUntrackedBytes (${this.config.maxUntrackedBytes})`)
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const target = resolve(artifactDir, 'untracked', path)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await copyFile(source, target)
      await chmod(target, 0o600)
      const mode = info.mode & 0o777
      untracked.push({ path, size: bytes.byteLength, sha256, mode })
      const binary = bytes.includes(0)
      const text = binary ? '' : bytes.toString('utf8')
      const added = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      changedFiles.push({ path, status: 'A', added, deleted: 0, binary, untracked: true })
    }
    await writeFileAtomic(resolve(artifactDir, 'untracked.json'), `${JSON.stringify(untracked, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })

    changedFiles.sort((left, right) => left.path.localeCompare(right.path))
    const hash = createHash('sha256').update(patch)
    for (const file of untracked) hash.update(`\0${file.path}\0${file.size}\0${file.sha256}\0${file.mode}`)
    const patchHash = hash.digest('hex')
    const preview = patch.slice(0, this.config.maxDiffPreviewChars)
    return {
      headCommit,
      patch,
      untracked,
      evidence: {
        patchHash,
        patchBytes: Buffer.byteLength(patch),
        untrackedBytes,
        changedFiles,
        addedLines: changedFiles.reduce((total, file) => total + file.added, 0),
        deletedLines: changedFiles.reduce((total, file) => total + file.deleted, 0),
        diffPreview: preview,
        diffPreviewTruncated: preview.length !== patch.length,
      },
    }
  }

  /** Built-in whitespace/conflict-marker check against the immutable base. */
  runDiffCheck(worktreePath: string, baseCommit: string, signal: AbortSignal): Promise<ProcessResult> {
    return this.gitAllowFailure(worktreePath, ['diff', '--check', baseCommit, '--'], signal)
  }

  /** Re-prove original HEAD and cleanliness immediately before promotion. */
  async assertOriginalUnchanged(repo: ArenaRepository, signal?: AbortSignal): Promise<void> {
    const current = await this.discover(repo.root, signal)
    if (current.baseCommit !== repo.baseCommit) {
      throw new Error(`original HEAD moved from ${repo.baseCommit} to ${current.baseCommit}; preview is stale`)
    }
  }

  /** Validate a tracked patch without touching the original worktree. */
  async checkPatch(repoRoot: string, patch: string, signal?: AbortSignal): Promise<void> {
    if (patch.length === 0) return
    await this.git(repoRoot, ['apply', '--check', '--whitespace=error-all', '-'], signal, this.config.maxOutputBytes, patch)
  }

  /** Apply a previously checked tracked patch. */
  async applyPatch(repoRoot: string, patch: string, signal?: AbortSignal): Promise<void> {
    if (patch.length === 0) return
    await this.git(repoRoot, ['apply', '--whitespace=nowarn', '-'], signal, this.config.maxOutputBytes, patch)
  }

  /** Reverse a just-applied patch during rollback. */
  async reversePatch(repoRoot: string, patch: string): Promise<void> {
    if (patch.length === 0) return
    await this.git(repoRoot, ['apply', '--reverse', '--whitespace=nowarn', '-'], undefined, this.config.maxOutputBytes, patch)
  }

  /** Compare the original worktree's tracked diff byte-for-byte with captured evidence. */
  async assertAppliedPatch(repo: ArenaRepository, expected: string, signal?: AbortSignal): Promise<void> {
    const actual = await this.git(
      repo.root,
      ['diff', '--binary', '--no-ext-diff', '--full-index', repo.baseCommit, '--'],
      signal,
      this.config.maxPatchBytes + 1,
    )
    if (actual.stdout !== expected) throw new Error('applied tracked diff does not match the selected contender evidence')
  }

  /** Verify copied untracked artifacts in the original worktree. */
  async assertUntracked(repoRoot: string, files: readonly ArenaUntrackedArtifact[]): Promise<void> {
    for (const file of files) {
      const path = repositoryAbsolutePath(repoRoot, safeRelativePath(repoRoot, file.path))
      await assertRepositoryContainment(repoRoot, path)
      const bytes = await readFile(path)
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (bytes.byteLength !== file.size || hash !== file.sha256) {
        throw new Error(`promoted untracked file does not match captured evidence: ${file.path}`)
      }
    }
  }

  /** Copy captured untracked files after preflight collision checks. */
  async preflightUntracked(repoRoot: string, files: readonly ArenaUntrackedArtifact[]): Promise<void> {
    for (const file of files) {
      const target = repositoryAbsolutePath(repoRoot, safeRelativePath(repoRoot, file.path))
      await assertRepositoryContainment(repoRoot, target)
      try {
        await lstat(target)
        throw new Error(`promotion target already exists: ${file.path}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }

  /** Copy captured untracked files after preflight collision checks. */
  async copyUntracked(
    repoRoot: string,
    artifactDir: string,
    files: readonly ArenaUntrackedArtifact[],
  ): Promise<string[]> {
    await this.preflightUntracked(repoRoot, files)
    const copied: string[] = []
    try {
      for (const file of files) {
        const target = repositoryAbsolutePath(repoRoot, safeRelativePath(repoRoot, file.path))
        const source = repositoryAbsolutePath(resolve(artifactDir, 'untracked'), safeRelativePath(artifactDir, file.path))
        await Promise.all([
          assertRepositoryContainment(repoRoot, target),
          assertRepositoryContainment(artifactDir, source),
        ])
        await mkdir(dirname(target), { recursive: true })
        await copyFile(source, target, fsConstants.COPYFILE_EXCL)
        copied.push(target)
        await chmod(target, file.mode)
      }
      return copied
    } catch (error) {
      try {
        await this.removeCopied(copied)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'copying untracked promotion files failed and rollback was incomplete',
        )
      }
      throw error
    }
  }

  /** Remove only explicit files created by a failed promotion. */
  async removeCopied(paths: readonly string[]): Promise<void> {
    const failures: unknown[] = []
    for (const path of [...paths].reverse()) {
      try {
        await rm(path, { force: true })
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'failed to remove copied promotion files')
  }

  /** Classify the original checkout after an interrupted promotion. */
  async promotionState(
    repo: ArenaRepository,
    candidate: { patch: string; untracked: readonly ArenaUntrackedArtifact[] },
  ): Promise<'clean' | 'exact' | 'partial-or-diverged'> {
    const tracked = await this.git(
      repo.root,
      ['diff', '--binary', '--no-ext-diff', '--full-index', repo.baseCommit, '--'],
      undefined,
      this.config.maxPatchBytes + 1,
    )
    let present = 0
    for (const file of candidate.untracked) {
      const target = repositoryAbsolutePath(repo.root, file.path)
      await assertRepositoryContainment(repo.root, target)
      try {
        const bytes = await readFile(target)
        const hash = createHash('sha256').update(bytes).digest('hex')
        if (bytes.byteLength !== file.size || hash !== file.sha256) return 'partial-or-diverged'
        present += 1
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    if (tracked.stdout.length === 0 && present === 0) return 'clean'
    if (tracked.stdout === candidate.patch && present === candidate.untracked.length) return 'exact'
    return 'partial-or-diverged'
  }

  /** Roll back only an exact or untracked-partial Arena candidate after a crashed promotion. */
  async recoverPromotionRollback(
    repo: ArenaRepository,
    candidate: { patch: string; untracked: readonly ArenaUntrackedArtifact[] },
  ): Promise<void> {
    const tracked = await this.git(
      repo.root,
      ['diff', '--binary', '--no-ext-diff', '--full-index', repo.baseCommit, '--'],
      undefined,
      this.config.maxPatchBytes + 1,
    )
    if (tracked.stdout.length !== 0 && tracked.stdout !== candidate.patch) {
      throw new Error('tracked files diverged from both the clean base and the selected Arena artifact')
    }
    const copied: string[] = []
    for (const file of candidate.untracked) {
      const target = repositoryAbsolutePath(repo.root, file.path)
      await assertRepositoryContainment(repo.root, target)
      try {
        const bytes = await readFile(target)
        const hash = createHash('sha256').update(bytes).digest('hex')
        if (bytes.byteLength !== file.size || hash !== file.sha256) {
          throw new Error(`promotion target was modified outside Arena: ${file.path}`)
        }
        copied.push(target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await this.removeCopied(copied)
    if (tracked.stdout === candidate.patch) await this.reversePatch(repo.root, candidate.patch)
    await this.assertOriginalUnchanged(repo)
  }

  private async git(
    cwd: string,
    args: readonly string[],
    signal?: AbortSignal,
    maxOutputBytes = this.config.maxOutputBytes,
    stdin?: string,
  ): Promise<ProcessResult> {
    const result = await this.gitAllowFailure(cwd, args, signal, maxOutputBytes, stdin)
    assertCompleteOutput(`git ${args[0] ?? 'command'}`, result)
    if (result.exitCode !== 0) throw new Error(`git ${args[0] ?? 'command'} failed: ${errorText(result)}`)
    return result
  }

  private gitAllowFailure(
    cwd: string,
    args: readonly string[],
    signal?: AbortSignal,
    maxOutputBytes = this.config.maxOutputBytes,
    stdin?: string,
  ): Promise<ProcessResult> {
    return this.runner.run(['git', ...args], {
      cwd,
      timeoutMs: Math.min(this.config.runTimeoutMs, 300_000),
      maxOutputBytes,
      ...signal === undefined ? {} : { signal },
      ...stdin === undefined ? {} : { stdin },
    })
  }
}
