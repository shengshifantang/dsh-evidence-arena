/** Host-selected launch recipes for explicit, disposable candidate previews. */

import { access, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

export interface CandidatePreviewLaunch {
  kind: 'static-output' | 'package-script'
  label: string
  argv: string[]
  publicArgv: string[]
  sandboxMode: 'read-only' | 'workspace-write'
  env: NodeJS.ProcessEnv
}

const STATIC_SERVER_SOURCE = String.raw`
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
let root=path.resolve(process.argv[1]);const port=Number(process.argv[2]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};
function send(res,file){fs.realpath(file,(e,real)=>{if(e||!(real===root||real.startsWith(root+path.sep)))return fallback(res);fs.stat(real,(e,s)=>{if(e||!s.isFile())return fallback(res);res.setHeader('Content-Type',mime[path.extname(real).toLowerCase()]||'application/octet-stream');fs.createReadStream(real).on('error',()=>{res.statusCode=500;res.end('read error')}).pipe(res)})})}
function fallback(res){const file=path.join(root,'index.html');fs.realpath(file,(e,real)=>{if(e||!real.startsWith(root+path.sep)){res.statusCode=404;return res.end('not found')}res.setHeader('Content-Type','text/html; charset=utf-8');fs.createReadStream(real).pipe(res)})}
fs.realpath(root,(e,real)=>{if(e)throw e;root=real;const server=http.createServer((req,res)=>{let name;try{name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname)}catch{return res.end('bad request')}const relative=name.replace(/^\/+/,''),file=path.resolve(real,relative||'index.html');if(!(file===real||file.startsWith(real+path.sep))){res.statusCode=400;return res.end('bad path')}fs.stat(file,(e,s)=>send(res,!e&&s.isDirectory()?path.join(file,'index.html'):file))});server.listen(port,'127.0.0.1',()=>console.log('ARENA_PREVIEW_READY http://127.0.0.1:'+port+'/'))});
`

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function packageScriptArgv(scriptName: string, script: string, port: number): string[] {
  const argv = ['npm', 'run', scriptName]
  if (/\bvite(?:\s|$)/iu.test(script)) {
    argv.push('--', '--host', '127.0.0.1', '--port', String(port), '--strictPort')
  } else if (/\bnext\s+(?:dev|start)\b/iu.test(script)) {
    argv.push('--', '--hostname', '127.0.0.1', '--port', String(port))
  }
  return argv
}

/** Prefer built output, then a declared package script, then a plain root index. Never installs dependencies. */
export async function selectCandidatePreviewLaunch(worktreePath: string, port: number): Promise<CandidatePreviewLaunch | undefined> {
  for (const directory of ['dist', 'build', 'out']) {
    const root = join(worktreePath, directory)
    if (await exists(join(root, 'index.html'))) {
      return {
        kind: 'static-output',
        label: `${directory}/index.html`,
        argv: [process.execPath, '-e', STATIC_SERVER_SOURCE, root, String(port)],
        publicArgv: [process.execPath, '<arena-static-server>', directory, String(port)],
        sandboxMode: 'read-only',
        env: { HOST: '127.0.0.1', PORT: String(port), CI: '1' },
      }
    }
  }

  try {
    const source: unknown = JSON.parse(await readFile(join(worktreePath, 'package.json'), 'utf8'))
    const scripts = typeof source === 'object' && source !== null && !Array.isArray(source)
      ? (source as { scripts?: unknown }).scripts
      : undefined
    if (typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)) {
      const entries = scripts as Record<string, unknown>
      for (const scriptName of ['preview', 'dev', 'start']) {
        const script = entries[scriptName]
        if (typeof script !== 'string' || script.trim().length === 0) continue
        const argv = packageScriptArgv(scriptName, script, port)
        return {
          kind: 'package-script',
          label: `npm run ${scriptName}`,
          argv,
          publicArgv: [...argv],
          sandboxMode: 'workspace-write',
          env: { HOST: '127.0.0.1', PORT: String(port), BROWSER: 'none', CI: '1' },
        }
      }
    }
  } catch { /* no valid package launch recipe */ }

  if (await exists(join(worktreePath, 'index.html'))) {
    return {
      kind: 'static-output',
      label: 'index.html',
      argv: [process.execPath, '-e', STATIC_SERVER_SOURCE, worktreePath, String(port)],
      publicArgv: [process.execPath, '<arena-static-server>', '.', String(port)],
      sandboxMode: 'read-only',
      env: { HOST: '127.0.0.1', PORT: String(port), CI: '1' },
    }
  }
  return undefined
}

/** Reserve a currently free loopback port. The subsequent bind still uses strict-port semantics where supported. */
export async function reserveLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => { reject(new Error('could not reserve a loopback TCP port')) })
        return
      }
      server.close((error) => { error === undefined ? resolve(address.port) : reject(error) })
    })
  })
}

/** Wait until the candidate returns any HTTP response; a non-2xx page is still inspectable. */
export async function waitForCandidatePreview(url: string, timeoutMs: number, exited: Promise<unknown>): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.min(1_500, timeoutMs)) })
      await response.body?.cancel()
      return
    } catch (error) {
      lastError = error
    }
    await Promise.race([
      exited.then(() => { throw new Error('candidate preview process exited before its loopback URL became reachable') }),
      new Promise(resolve => setTimeout(resolve, 150)),
    ])
  }
  throw new Error(`candidate preview did not become reachable within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
