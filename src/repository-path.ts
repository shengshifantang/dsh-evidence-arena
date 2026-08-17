/** Cross-platform repository path normalization and symlink/junction containment. */

import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path'

function outside(relativePath: string, separator: string): boolean {
  return relativePath === '..' || relativePath.startsWith(`..${separator}`) || isAbsolute(relativePath)
}

/** Validate a Git-style repository-relative path and retain `/` separators on every platform. */
export function normalizeRepositoryPath(value: string): string {
  if (value.length === 0 || value.includes('\0') || value.includes('\\')
    || posix.isAbsolute(value) || win32.isAbsolute(value)) {
    throw new Error(`unsafe repository path ${JSON.stringify(value)}`)
  }
  const normalized = posix.normalize(value)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`repository path escapes its root: ${JSON.stringify(value)}`)
  }
  return normalized
}

/** Convert one portable repository path into a contained native absolute path. */
export function repositoryAbsolutePath(root: string, value: string): string {
  const portable = normalizeRepositoryPath(value)
  const absolute = resolve(root, ...portable.split('/'))
  const back = relative(root, absolute)
  if (outside(back, sep)) throw new Error(`repository path escapes its root: ${JSON.stringify(value)}`)
  return absolute
}

/** Compare native paths with Windows' case-insensitive path semantics when requested. */
export function sameNativePath(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
  const pathApi = platform === 'win32' ? win32 : { resolve }
  const normalizedLeft = pathApi.resolve(left)
  const normalizedRight = pathApi.resolve(right)
  return platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

async function deepestExistingAncestor(path: string): Promise<string> {
  let current = path
  for (;;) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

/** Reject a read or write target whose existing path chain escapes through a symlink or Windows junction. */
export async function assertRepositoryContainment(root: string, target: string): Promise<void> {
  const [realRoot, ancestor] = await Promise.all([realpath(root), deepestExistingAncestor(target)])
  const realAncestor = await realpath(ancestor)
  const back = relative(realRoot, realAncestor)
  if (outside(back, sep)) throw new Error(`repository target escapes through a link or junction: ${target}`)
}
