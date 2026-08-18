import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalGitPatch, portableUntrackedMode } from '../src/git.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

describe('Arena Windows runtime composition', () => {
  it('canonicalizes Git patch framing and synthetic Windows permission bits', () => {
    expect(canonicalGitPatch('diff --git a/a b/a\r\n+safe\r\n')).toBe('diff --git a/a b/a\n+safe\n')
    expect(canonicalGitPatch('binary\rpayload\n')).toBe('binary\rpayload\n')
    expect(portableUntrackedMode(0o100666, 'win32')).toBe(0o600)
    expect(portableUntrackedMode(0o100755, 'linux')).toBe(0o755)
  })

  it('selects exactly one sandboxed shell family and never gives Reviewers a shell', async () => {
    const runtime = await readFile(`${packageRoot}/runtime/cordis.yml`, 'utf8')
    expect(runtime).toContain("name: '@deepseek-ai/dsh-pwsh-sandbox'")
    expect(runtime).toContain("name: '@deepseek-ai/dsh-tool-pwsh'")
    expect(runtime).toContain("process.platform !== 'win32' || process.env.DSH_ARENA_ROLE === 'reviewer'")
    expect(runtime).toContain("process.platform === 'win32' || process.env.DSH_ARENA_ROLE === 'reviewer' ? false")
    expect(runtime).toContain('enableRunInBackground: false')
    expect(runtime).toContain("process.env.DSH_ARENA_ROLE === 'reviewer' ? 'off' : 'max'")
  })

  it('declares Loader-resolved PowerShell packages as Host peers and keeps the transitive runtime buildable', async () => {
    const manifest = JSON.parse(await readFile(`${packageRoot}/package.json`, 'utf8')) as {
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(manifest.peerDependencies).toMatchObject({
      '@deepseek-ai/dsh-pwsh-sandbox': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-tool-pwsh': '^0.1.0-rc.7',
    })
    expect(manifest.devDependencies).toMatchObject({
      '@deepseek-ai/dsh-pwsh-local': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-pwsh-sandbox': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-tool-pwsh': '^0.1.0-rc.7',
    })
  })
})
