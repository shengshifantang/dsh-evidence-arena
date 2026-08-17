// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseUnifiedDiffRows } from '../src/client/ArenaDiffReview.tsx'

describe('Arena unified diff rows', () => {
  it('tracks old and new line numbers across additions and deletions', () => {
    const rows = parseUnifiedDiffRows([
      '@@ -3,2 +7,3 @@',
      ' context',
      '-removed',
      '+added',
      '+second',
    ].join('\n'))

    expect(rows).toEqual([
      { kind: 'hunk', text: '@@ -3,2 +7,3 @@' },
      { kind: 'context', oldLine: 3, newLine: 7, text: ' context' },
      { kind: 'del', oldLine: 4, text: '-removed' },
      { kind: 'add', newLine: 8, text: '+added' },
      { kind: 'add', newLine: 9, text: '+second' },
    ])
  })
})
