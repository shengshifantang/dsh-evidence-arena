/** Managed argv-only process execution over DSH's tree-scoped subprocess seam. */

import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ArenaSandboxFacts } from './types.ts'

/** One bounded process result. Non-zero exit is data; spawn failures reject. */
export interface ProcessResult {
  argv: string[]
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  timedOut: boolean
  aborted: boolean
  durationMs: number
  sandbox?: ArenaSandboxFacts
}

/** Explicit per-command policy; this layer never invokes a shell. */
export interface ProcessRunOptions {
  cwd: string
  signal?: AbortSignal
  timeoutMs: number
  maxOutputBytes: number
  stdin?: string
  env?: NodeJS.ProcessEnv
  /** Harness file-effect confinement. Network and host reads are explicitly outside this seam. */
  sandbox?: {
    mode: 'read-only' | 'workspace-write'
    workspaceRoot: string
  }
}

/** Live, bounded process used only for an explicitly started candidate preview. */
export interface ManagedProcessHandle {
  readonly argv: string[]
  readonly pid: number
  readonly sandbox?: ArenaSandboxFacts
  readonly done: Promise<ProcessResult>
  output(): {
    stdout: string
    stderr: string
    stdoutTruncated: boolean
    stderrTruncated: boolean
  }
  stop(): Promise<ProcessResult>
}

export type ProcessStartOptions = Omit<ProcessRunOptions, 'timeoutMs' | 'stdin'>

/** Managed subprocess adapter shared by Git operations and deterministic judge commands. */
export class ManagedProcessRunner {
  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly graceMs: number,
    private readonly sandbox?: SandboxProvider,
  ) {}

  /** Execute one non-empty argv through DSH's whole-process-tree lifecycle. */
  async run(argv: readonly string[], options: ProcessRunOptions): Promise<ProcessResult> {
    if (argv.length === 0 || argv[0]?.length === 0) throw new TypeError('dsh-arena process argv must contain a program')
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new TypeError('dsh-arena process timeoutMs must be a positive safe integer')
    }
    if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
      throw new TypeError('dsh-arena process maxOutputBytes must be a positive safe integer')
    }
    options.signal?.throwIfAborted()

    const requestedArgv = [...argv]
    let executionArgv = requestedArgv
    let sandboxFacts: ArenaSandboxFacts | undefined
    if (options.sandbox !== undefined) {
      if (this.sandbox === undefined) throw new Error('dsh-arena required Harness sandbox service is unavailable')
      const confined = this.sandbox.confine(requestedArgv, options.sandbox)
      executionArgv = confined.argv
      sandboxFacts = {
        mode: options.sandbox.mode,
        enforcement: confined.enforcement,
        networkIsolated: false,
        hostReadsIsolated: false,
      }
    }

    const startedAt = Date.now()
    const controller = new AbortController()
    let timedOut = false
    const onAbort = (): void => { controller.abort(options.signal?.reason) }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error(`process timed out after ${options.timeoutMs}ms`))
    }, options.timeoutMs)
    timer.unref()

    try {
      const handle = this.subprocess.spawn({
        argv: executionArgv,
        cwd: options.cwd,
        stdio: {
          stdin: options.stdin === undefined ? 'ignore' : { data: options.stdin },
          stdout: { maxBytes: options.maxOutputBytes },
          stderr: { maxBytes: options.maxOutputBytes },
        },
        graceMs: this.graceMs,
        signal: controller.signal,
        ...options.env === undefined ? {} : { env: options.env },
      })
      const outcome = await handle.done
      await handle.waitForExit()
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      return {
        argv: requestedArgv,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        stdout: stdout?.text ?? '',
        stderr: stderr?.text ?? '',
        stdoutTruncated: stdout?.lossy ?? false,
        stderrTruncated: stderr?.lossy ?? false,
        timedOut,
        aborted: options.signal?.aborted === true,
        durationMs: Date.now() - startedAt,
        ...sandboxFacts === undefined ? {} : { sandbox: sandboxFacts },
      }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  /** Start one long-running managed process and retain bounded live diagnostics. */
  start(argv: readonly string[], options: ProcessStartOptions): ManagedProcessHandle {
    if (argv.length === 0 || argv[0]?.length === 0) throw new TypeError('dsh-arena process argv must contain a program')
    if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
      throw new TypeError('dsh-arena process maxOutputBytes must be a positive safe integer')
    }
    options.signal?.throwIfAborted()

    const requestedArgv = [...argv]
    let executionArgv = requestedArgv
    let sandboxFacts: ArenaSandboxFacts | undefined
    if (options.sandbox !== undefined) {
      if (this.sandbox === undefined) throw new Error('dsh-arena required Harness sandbox service is unavailable')
      const confined = this.sandbox.confine(requestedArgv, options.sandbox)
      executionArgv = confined.argv
      sandboxFacts = {
        mode: options.sandbox.mode,
        enforcement: confined.enforcement,
        networkIsolated: false,
        hostReadsIsolated: false,
      }
    }

    const startedAt = Date.now()
    const handle: SubprocessHandle = this.subprocess.spawn({
      argv: executionArgv,
      cwd: options.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: options.maxOutputBytes },
        stderr: { maxBytes: options.maxOutputBytes },
      },
      graceMs: this.graceMs,
      ...options.signal === undefined ? {} : { signal: options.signal },
      ...options.env === undefined ? {} : { env: options.env },
    })
    const output = () => {
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      return {
        stdout: stdout?.text ?? '',
        stderr: stderr?.text ?? '',
        stdoutTruncated: stdout?.lossy ?? false,
        stderrTruncated: stderr?.lossy ?? false,
      }
    }
    const done = handle.done.then(async (outcome) => {
      await handle.waitForExit()
      return {
        argv: requestedArgv,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        ...output(),
        timedOut: false,
        aborted: options.signal?.aborted === true,
        durationMs: Date.now() - startedAt,
        ...sandboxFacts === undefined ? {} : { sandbox: sandboxFacts },
      }
    })
    return {
      argv: requestedArgv,
      pid: handle.pid,
      ...sandboxFacts === undefined ? {} : { sandbox: sandboxFacts },
      done,
      output,
      stop: async () => {
        handle.terminate()
        return await done
      },
    }
  }
}
