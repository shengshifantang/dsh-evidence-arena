import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const dsh = process.env.DSH_BIN?.trim() || (process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
const home = process.env.DSH_HOME?.trim()
if (!home) throw new Error('smoke-profile requires an isolated DSH_HOME')

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function freeLoopbackPort() {
  const server = createServer()
  server.unref()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('could not reserve a loopback port')
  await new Promise((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
  return address.port
}

function appendTail(current, chunk, limit = 65_536) {
  const next = current + String(chunk)
  return next.length <= limit ? next : next.slice(-limit)
}

const env = { ...process.env, DSH_HOME: home }
const dump = await execFileAsync(dsh, ['--profile', 'web', '--dump-config'], {
  env,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
})
const composition = `${dump.stdout}\n${dump.stderr}`
if (!composition.includes('dsh-evidence-arena')) {
  throw new Error('clean profile composition does not contain dsh-evidence-arena')
}

const port = await freeLoopbackPort()
const child = spawn(dsh, ['--profile', 'web', '--host', '127.0.0.1', '--port', String(port)], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stdout = ''
let stderr = ''
child.stdout.on('data', chunk => { stdout = appendTail(stdout, chunk) })
child.stderr.on('data', chunk => { stderr = appendTail(stderr, chunk) })

try {
  const deadline = Date.now() + 45_000
  let response
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`DSH Host exited before readiness (code ${child.exitCode})\n${stdout}\n${stderr}`)
    }
    try {
      response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) break
    } catch {
      // The Host has not bound the loopback socket yet.
    }
    await delay(250)
  }
  if (response === undefined || !response.ok) {
    throw new Error(`DSH Host did not return HTTP 200 within 45s\n${stdout}\n${stderr}`)
  }
  const html = await response.text()
  if (!/<(?:!doctype|html)\b/iu.test(html)) throw new Error('DSH Host root did not return an HTML document')
  console.log(`clean DSH profile composed Evidence Arena and returned HTTP ${response.status}`)
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), delay(5_000)])
  }
  if (child.exitCode === null) child.kill('SIGKILL')
}
