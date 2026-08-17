/** Pure helpers for indexing one sealed Git patch into reviewable per-file diffs. */

import type { ArenaChangedFile } from './types.ts'

function headerPath(line: string, prefix: '--- ' | '+++ '): string | undefined {
  if (!line.startsWith(prefix)) return undefined
  let value = line.slice(prefix.length)
  if (value === '/dev/null') return undefined
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed !== 'string') return undefined
      value = parsed
    } catch { return undefined }
  } else {
    value = value.split('\t', 1)[0] ?? value
  }
  return value.startsWith('a/') || value.startsWith('b/') ? value.slice(2) : value
}

/** Split a `git diff --binary` artifact without losing each segment's terminators. */
export function splitTrackedPatch(patch: string): string[] {
  const starts: number[] = []
  const pattern = /^diff --git /gmu
  for (let match = pattern.exec(patch); match !== null; match = pattern.exec(patch)) starts.push(match.index)
  return starts.map((start, index) => patch.slice(start, starts[index + 1] ?? patch.length))
}

/** Resolve one tracked path from immutable changed-file metadata plus the complete patch. */
export function trackedFilePatch(
  patch: string,
  files: readonly ArenaChangedFile[],
  path: string,
): string | undefined {
  const segments = splitTrackedPatch(patch)
  for (const segment of segments) {
    const paths = segment.split('\n').flatMap((line) => {
      const oldPath = headerPath(line, '--- ')
      const newPath = headerPath(line, '+++ ')
      return [oldPath, newPath].filter((value): value is string => value !== undefined)
    })
    if (paths.includes(path)) return segment
  }

  // Git and `changedFiles` are both path ordered. This fallback covers quoted
  // names that use Git's octal C escaping while refusing an ambiguous mapping.
  const tracked = files.filter(file => !file.untracked)
  const index = tracked.findIndex(file => file.path === path)
  return segments.length === tracked.length && index >= 0 ? segments[index] : undefined
}

/** Present a sealed untracked text file as an ordinary unified new-file patch. */
export function untrackedFilePatch(path: string, mode: number, text: string): string {
  const executable = (mode & 0o111) !== 0
  const trailingNewline = text.endsWith('\n')
  const body = text.length === 0 ? '' : trailingNewline ? text.slice(0, -1) : text
  const lines = body.length === 0 ? [] : body.split('\n')
  const hunk = lines.length === 0 ? '@@ -0,0 +0,0 @@' : `@@ -0,0 +1,${lines.length} @@`
  const additions = lines.map(line => `+${line}`).join('\n')
  const noNewline = text.length > 0 && !trailingNewline ? '\n\\ No newline at end of file' : ''
  return [
    `diff --git a/${path} b/${path}`,
    `new file mode ${executable ? '100755' : '100644'}`,
    '--- /dev/null',
    `+++ b/${path}`,
    hunk,
    `${additions}${noNewline}`,
  ].join('\n') + '\n'
}

/** Bound browser rendering while retaining the exact total for an explicit warning. */
export function boundFileDiff(diff: string, maxChars: number): {
  diff: string
  totalChars: number
  truncated: boolean
} {
  const totalChars = diff.length
  return {
    diff: diff.slice(0, Math.max(1, maxChars)),
    totalChars,
    truncated: totalChars > maxChars,
  }
}
