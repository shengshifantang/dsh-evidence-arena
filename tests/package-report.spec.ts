import { describe, expect, it } from 'vitest'
import { parseNpmPackReport } from '../scripts/npm-pack-report.mjs'

describe('npm package report parsing', () => {
  it('extracts the outer report after ANSI lifecycle output and nested arrays', () => {
    const stdout = [
      '\u001b[34mℹ tsdown build [client]\u001b[39m',
      '[',
      '  {"files":[{"path":"lib/index.js"}]}',
      ']',
      '',
    ].join('\n')
    expect(parseNpmPackReport(stdout)).toEqual([{ files: [{ path: 'lib/index.js' }] }])
  })

  it('rejects log-only output without echoing it into the error', () => {
    const sensitiveLog = 'build failed with local secret fixture'
    expect(() => parseNpmPackReport(sensitiveLog)).toThrow('npm pack did not emit a valid JSON report')
    try {
      parseNpmPackReport(sensitiveLog)
    } catch (error) {
      expect(String(error)).not.toContain(sensitiveLog)
    }
  })
})
