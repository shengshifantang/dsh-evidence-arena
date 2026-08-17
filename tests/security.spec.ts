import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.ts'
import type { CapturedCandidate } from '../src/git.ts'
import { buildReviewBundle, hasBlockingSecurityFinding, scanCandidateSecurity } from '../src/security.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

function config(root: string) {
  return resolveConfig(Config({ stateRoot: root } as Config))
}

function candidate(patch: string): CapturedCandidate {
  return {
    headCommit: 'a'.repeat(40),
    patch,
    untracked: [],
    evidence: {
      patchHash: 'b'.repeat(64), patchBytes: Buffer.byteLength(patch), untrackedBytes: 0,
      changedFiles: [{ path: 'src/app.ts', status: 'M', added: 1, deleted: 0, binary: false, untracked: false }],
      addedLines: 1, deletedLines: 0, diffPreview: patch, diffPreviewTruncated: false,
    },
  }
}

describe('Arena deterministic security screening', () => {
  it('fingerprints a literal secret without retaining the matched value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arena-security-'))
    roots.push(root)
    const secret = `sk-proj-${'A'.repeat(32)}`
    const captured = candidate([
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -0,0 +1 @@',
      `+const apiKey = "${secret}"`,
      '',
    ].join('\n'))
    const findings = await scanCandidateSecurity(captured, root, config(root))
    expect(hasBlockingSecurityFinding(findings)).toBe(true)
    expect(findings.some(item => item.fingerprint?.length === 64)).toBe(true)
    expect(JSON.stringify(findings)).not.toContain(secret)
  })

  it('blocks tracked symlinks and group-writable captured artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arena-security-'))
    roots.push(root)
    await mkdir(join(root, 'untracked'), { recursive: true })
    await writeFile(join(root, 'untracked', 'tool.sh'), '#!/bin/sh\necho safe\n')
    const captured = candidate('diff --git a/link b/link\nnew file mode 120000\n')
    captured.untracked = [{ path: 'tool.sh', size: 20, sha256: 'c'.repeat(64), mode: 0o775 }]
    captured.evidence.changedFiles.push({ path: 'tool.sh', status: 'A', added: 2, deleted: 0, binary: false, untracked: true })
    const findings = await scanCandidateSecurity(captured, root, config(root))
    expect(findings.map(item => item.ruleId)).toEqual(expect.arrayContaining(['tracked-symlink', 'writable-artifact-mode']))
  })

  it('builds reviewer input from the sealed artifact copy, not a live worktree path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arena-security-'))
    roots.push(root)
    await mkdir(join(root, 'untracked'), { recursive: true })
    await writeFile(join(root, 'untracked', 'proof.txt'), 'sealed evidence\n')
    const captured = candidate('')
    captured.untracked = [{ path: 'proof.txt', size: 16, sha256: 'd'.repeat(64), mode: 0o644 }]
    captured.evidence.changedFiles = [{ path: 'proof.txt', status: 'A', added: 1, deleted: 0, binary: false, untracked: true }]
    const bundle = await buildReviewBundle(captured, root, 10_000)
    expect(bundle).toContain('sealed evidence')
    expect(bundle).toContain('Untracked file: proof.txt')
  })
})
