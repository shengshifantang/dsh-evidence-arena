import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { npmPackInvocation } from './npm-pack-invocation.mjs'
import { parseNpmPackReport } from './npm-pack-report.mjs'

const root = new URL('../', import.meta.url)
const rootPath = fileURLToPath(root)
const execFileAsync = promisify(execFile)
const required = [
  'lib/index.js',
  'lib/invariant.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
  'lib/types/types.js',
  'lib/types/types.d.ts',
  'cordis.patch.yml',
  'runtime/cordis.yml',
  'README.md',
  'README.zh.md',
  'docs/ARCHITECTURE.zh.md',
  'docs/images/evidence-arena-setup.png',
  'LICENSE',
  'NOTICE.md',
]

for (const file of required) await access(new URL(file, root))

const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
if (manifest.name !== 'dsh-evidence-arena') throw new Error('package name drift')

const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
if (!patch.includes("name: 'dsh-evidence-arena'")) throw new Error('Cordis patch package name drift')

const client = await readFile(new URL('lib/client.js', root), 'utf8')
if (!client.includes('dsh-evidence-arena')) throw new Error('client bundle id drift')
if (!client.includes('__ModuleLoader__')) throw new Error('client bundle is not a DSH module-loader factory')
if (client.includes(rootPath)) throw new Error('client bundle leaks the build checkout path')
if (/dsh-css:(?:\/|[A-Za-z]:\\)/u.test(client)) throw new Error('client bundle contains an absolute CSS virtual id')

function collectExportTargets(value, output = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('./')) output.add(value.slice(2))
    return output
  }
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) collectExportTargets(nested, output)
  }
  return output
}

const expectedPacked = new Set([
  ...required,
  'package.json',
  manifest.main,
  manifest.types,
  ...collectExportTargets(manifest.exports),
].filter(value => typeof value === 'string'))

// Checking the build tree alone cannot catch a file omitted by package.json#files.
// Ask npm for the exact archive manifest while suppressing lifecycle scripts so
// this remains safe when invoked from prepack itself.
const cache = await mkdtemp(join(tmpdir(), 'dsh-evidence-arena-npm-cache-'))
try {
  const npm = npmPackInvocation()
  const { stdout } = await execFileAsync(npm.command, npm.args, {
    cwd: rootPath,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
    maxBuffer: 8 * 1024 * 1024,
  })
  const report = parseNpmPackReport(stdout)
  const files = report?.[0]?.files
  if (!Array.isArray(files)) throw new Error('npm pack did not return a file manifest')
  const packed = new Set(files.map(file => file.path))
  const missing = [...expectedPacked].filter(file => !packed.has(file))
  if (missing.length > 0) throw new Error(`npm tarball is missing required files: ${missing.join(', ')}`)
  console.log(`verified ${required.length} build artifacts and ${packed.size} packed files`)
} finally {
  await rm(cache, { recursive: true, force: true })
}
