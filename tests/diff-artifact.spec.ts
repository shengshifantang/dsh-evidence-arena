import { describe, expect, it } from 'vitest'
import {
  boundFileDiff,
  splitTrackedPatch,
  trackedFilePatch,
  untrackedFilePatch,
} from '../src/diff-artifact.ts'
import type { ArenaChangedFile } from '../src/types.ts'

const trackedFiles: ArenaChangedFile[] = [
  { path: 'src/a.ts', status: 'M', added: 1, deleted: 1, binary: false, untracked: false },
  { path: 'src/b.ts', status: 'M', added: 1, deleted: 0, binary: false, untracked: false },
]

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -0,0 +1 @@',
  '+added',
  '',
].join('\n')

describe('Arena sealed diff presentation', () => {
  it('indexes one complete tracked patch without mixing file segments', () => {
    expect(splitTrackedPatch(patch)).toHaveLength(2)
    const selected = trackedFilePatch(patch, trackedFiles, 'src/b.ts')
    expect(selected).toContain('diff --git a/src/b.ts b/src/b.ts')
    expect(selected).toContain('+added')
    expect(selected).not.toContain('-old')
  })

  it('presents a sealed untracked text file as a standard new-file patch', () => {
    expect(untrackedFilePatch('scripts/run.sh', 0o755, '#!/bin/sh\necho ok')).toBe([
      'diff --git a/scripts/run.sh b/scripts/run.sh',
      'new file mode 100755',
      '--- /dev/null',
      '+++ b/scripts/run.sh',
      '@@ -0,0 +1,2 @@',
      '+#!/bin/sh',
      '+echo ok',
      '\\ No newline at end of file',
      '',
    ].join('\n'))
  })

  it('bounds only the browser copy and reports the exact total size', () => {
    expect(boundFileDiff('123456', 4)).toEqual({ diff: '1234', totalChars: 6, truncated: true })
    expect(boundFileDiff('1234', 4)).toEqual({ diff: '1234', totalChars: 4, truncated: false })
  })
})
