import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertRepositoryContainment,
  normalizeRepositoryPath,
  repositoryAbsolutePath,
  sameNativePath,
} from '../src/repository-path.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

describe('portable Arena repository paths', () => {
  it('retains Git separators and rejects POSIX, drive, UNC, backslash, and traversal paths', () => {
    expect(normalizeRepositoryPath('src/nested/file.ts')).toBe('src/nested/file.ts')
    for (const unsafe of ['/etc/passwd', 'C:/Windows/System32', 'C:\\Windows\\System32', '\\\\server\\share', '../escape', 'src\\file.ts']) {
      expect(() => normalizeRepositoryPath(unsafe)).toThrow(/unsafe|escapes/iu)
    }
  })

  it('models Windows case-insensitive native worktree identity without changing POSIX semantics', () => {
    expect(sameNativePath('C:\\Arena\\Run', 'c:\\arena\\run', 'win32')).toBe(true)
    expect(sameNativePath('/Arena/Run', '/arena/run', 'darwin')).toBe(false)
  })

  it('rejects an existing symlink or junction ancestor that leaves the repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arena-path-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-arena-path-outside-'))
    roots.push(root, outside)
    await writeFile(join(outside, 'secret.txt'), 'outside\n')
    await symlink(outside, join(root, 'linked'))
    const target = repositoryAbsolutePath(root, 'linked/secret.txt')
    await expect(assertRepositoryContainment(root, target)).rejects.toThrow('escapes through a link or junction')
  })
})
