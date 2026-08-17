import { access, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
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

console.log(`verified ${required.length} package artifacts`)
