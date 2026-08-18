/** Private append-only Arena v4 run store with atomic materialized snapshots. */

import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  ARENA_STATE_VERSION,
  isActiveArenaStatus,
  type ArenaRunState,
  type ArenaSetupReport,
  type ArenaStateEvent,
} from './types.ts'

const EVENTS_FILE = 'events.jsonl'
const STATE_FILE = 'state.json'
const SETUP_REPORT_VERSION = 1 as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRunState(value: unknown, expectedRunId?: string): asserts value is ArenaRunState {
  if (!isRecord(value)
    || value.version !== ARENA_STATE_VERSION
    || typeof value.runId !== 'string'
    || typeof value.workspaceId !== 'string'
    || (expectedRunId !== undefined && value.runId !== expectedRunId)
    || typeof value.status !== 'string'
    || !Number.isSafeInteger(value.revision)
    || !isRecord(value.policy)
    || !isRecord(value.budget)
    || !Array.isArray(value.contenders)) {
    throw new Error(`dsh-arena invalid v${ARENA_STATE_VERSION} run state${expectedRunId === undefined ? '' : ` for ${expectedRunId}`}`)
  }
}

function assertStateEvent(value: unknown, expectedRunId: string, expectedSeq: number): asserts value is ArenaStateEvent {
  if (!isRecord(value)
    || value.version !== ARENA_STATE_VERSION
    || value.seq !== expectedSeq
    || typeof value.time !== 'number'
    || typeof value.type !== 'string'
    || typeof value.note !== 'string'
    || !('state' in value)) {
    throw new Error(`dsh-arena invalid state event ${expectedSeq} for ${expectedRunId}`)
  }
  assertRunState(value.state, expectedRunId)
}

function assertSetupReport(value: unknown, expectedWorkspaceId: string): asserts value is ArenaSetupReport {
  if (!isRecord(value)
    || !isRecord(value.preflight)
    || !isRecord(value.preflight.budget)
    || value.workspaceId !== expectedWorkspaceId
    || typeof value.policyText !== 'string'
    || typeof value.canWritePolicy !== 'boolean'
    || (value.repoRoot !== undefined && typeof value.repoRoot !== 'string')
    || (value.policyPath !== undefined && typeof value.policyPath !== 'string')
    || (value.loadedPolicyDigest !== undefined && typeof value.loadedPolicyDigest !== 'string')) {
    throw new Error(`dsh-arena invalid setup report for ${expectedWorkspaceId}`)
  }
}

/** One serialized run writer. Event append is authoritative; state.json is a read-optimized projection. */
export class ArenaRunRecord {
  private current: ArenaRunState
  private nextSeq: number
  private tail: Promise<void> = Promise.resolve()

  constructor(
    readonly directory: string,
    initial: ArenaRunState,
    nextSeq: number,
    private readonly diagnostic: (message: string) => void,
  ) {
    this.current = structuredClone(initial)
    this.nextSeq = nextSeq
  }

  /** Detached state snapshot safe for callers and RPC serialization. */
  snapshot(): ArenaRunState {
    return structuredClone(this.current)
  }

  /** Serialize one full-projection event and atomically refresh state.json. */
  update(
    type: ArenaStateEvent['type'],
    note: string,
    mutate: (draft: ArenaRunState) => void,
  ): Promise<ArenaRunState> {
    let resolveResult!: (state: ArenaRunState) => void
    let rejectResult!: (error: unknown) => void
    const result = new Promise<ArenaRunState>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.current)
      mutate(next)
      next.revision = this.current.revision + 1
      next.updatedAt = Date.now()
      assertRunState(next, this.current.runId)
      const event: ArenaStateEvent = {
        version: ARENA_STATE_VERSION,
        seq: this.nextSeq,
        time: next.updatedAt,
        type,
        note,
        state: next,
      }
      await appendFile(join(this.directory, EVENTS_FILE), `${JSON.stringify(event)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      this.current = structuredClone(next)
      this.nextSeq += 1
      try {
        await writeFileAtomic(join(this.directory, STATE_FILE), `${JSON.stringify(next, null, 2)}\n`, {
          mode: 0o600,
          dirMode: 0o700,
        })
      } catch (error) {
        this.diagnostic(`run ${next.runId} state projection could not be refreshed: ${error instanceof Error ? error.message : String(error)}`)
      }
      resolveResult(structuredClone(next))
    })
    operation.catch(rejectResult)
    this.tail = operation.catch(() => {})
    return result
  }
}

/** Store for every v4 run below one configured private state root. */
export class ArenaStore {
  private readonly records = new Map<string, ArenaRunRecord>()

  constructor(
    readonly root: string,
    private readonly diagnostic: (message: string) => void,
  ) {}

  /** Runs live under `runs`; worktrees are separate so artifacts survive cleanup. */
  runsRoot(): string {
    return join(this.root, 'runs')
  }

  /** Detached worktree location for one contender. */
  worktreePath(runId: string, contenderId: string): string {
    return join(this.root, 'worktrees', runId, contenderId)
  }

  /** Private evidence/artifact directory for one contender. */
  contenderArtifacts(runId: string, contenderId: string): string {
    return join(this.runsRoot(), runId, 'contenders', contenderId)
  }

  /** One immutable context artifact shared across all contenders in the run. */
  sharedContextPath(runId: string): string {
    return join(this.runsRoot(), runId, 'shared-context.txt')
  }

  /** Persist a workspace report so Loader service boundaries and Host restarts are transparent. */
  async saveSetupReport(report: ArenaSetupReport): Promise<void> {
    assertSetupReport(report, report.workspaceId)
    const directory = join(this.root, 'setup-reports')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const envelope = {
      version: SETUP_REPORT_VERSION,
      savedAt: Date.now(),
      report: structuredClone(report),
    }
    await writeFileAtomic(this.setupReportPath(report.workspaceId), `${JSON.stringify(envelope)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }

  /** Load one Host-produced setup report without accepting a client-supplied repository path. */
  async loadSetupReport(workspaceId: string): Promise<ArenaSetupReport | undefined> {
    let text: string
    try {
      text = await readFile(this.setupReportPath(workspaceId), 'utf8')
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return undefined
      throw error
    }
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || parsed.version !== SETUP_REPORT_VERSION || typeof parsed.savedAt !== 'number') {
      throw new Error(`dsh-arena invalid setup report envelope for ${workspaceId}`)
    }
    assertSetupReport(parsed.report, workspaceId)
    return structuredClone(parsed.report)
  }

  /** Load valid v4 history; ArenaService owns recovery of live operations. */
  async initialize(): Promise<void> {
    await mkdir(this.runsRoot(), { recursive: true, mode: 0o700 })
    let entries: Array<import('node:fs').Dirent<string>>
    try {
      entries = await readdir(this.runsRoot(), { withFileTypes: true, encoding: 'utf8' })
    } catch (error) {
      throw new Error(`dsh-arena cannot enumerate ${this.runsRoot()}`, { cause: error })
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const loaded = await this.load(entry.name)
        this.records.set(entry.name, loaded)
      } catch (error) {
        this.diagnostic(`run ${entry.name} was not loaded: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** Create a new run directory and its seq-0 authoritative event. */
  async create(initial: ArenaRunState): Promise<ArenaRunRecord> {
    assertRunState(initial, initial.runId)
    if (this.records.has(initial.runId)) throw new Error(`dsh-arena run ${initial.runId} already exists`)
    const directory = join(this.runsRoot(), initial.runId)
    await mkdir(directory, { recursive: false, mode: 0o700 })
    const event: ArenaStateEvent = {
      version: ARENA_STATE_VERSION,
      seq: 0,
      time: initial.createdAt,
      type: 'run/created',
      note: 'Run admitted against one immutable policy and Git base.',
      state: structuredClone(initial),
    }
    await appendFile(join(directory, EVENTS_FILE), `${JSON.stringify(event)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    try {
      await writeFileAtomic(join(directory, STATE_FILE), `${JSON.stringify(initial, null, 2)}\n`, {
        mode: 0o600,
        dirMode: 0o700,
      })
    } catch (error) {
      this.diagnostic(`run ${initial.runId} initial state projection could not be written: ${error instanceof Error ? error.message : String(error)}`)
    }
    const record = new ArenaRunRecord(directory, initial, 1, this.diagnostic)
    this.records.set(initial.runId, record)
    return record
  }

  /** Read one loaded run. */
  get(runId: string): ArenaRunRecord | undefined {
    return this.records.get(runId)
  }

  /** Snapshot every run, newest update first. */
  list(): ArenaRunState[] {
    return [...this.records.values()]
      .map(record => record.snapshot())
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  /** Records whose child operations must be resumed after initialization. */
  recoverable(): ArenaRunRecord[] {
    return [...this.records.values()].filter(record => isActiveArenaStatus(record.snapshot().status))
  }

  /** Records with a write-ahead promotion that did not reach a terminal phase. */
  incompletePromotions(): ArenaRunRecord[] {
    return [...this.records.values()].filter((record) => {
      const phase = record.snapshot().promotionTransaction?.phase
      return phase !== undefined && !['committed', 'rolled-back', 'needs-attention'].includes(phase)
    })
  }

  private async load(runId: string): Promise<ArenaRunRecord> {
    const directory = join(this.runsRoot(), runId)
    const eventsPath = join(directory, EVENTS_FILE)
    const text = await readFile(eventsPath, 'utf8')
    const hasCompleteTrailingLine = text.endsWith('\n')
    const lines = text.split('\n')
    const nonEmptyIndices = lines.flatMap((line, index) => line.length === 0 ? [] : [index])
    let latest: ArenaRunState | undefined
    let nextSeq = 0
    let tornTrailingLine = false
    for (const index of nonEmptyIndices) {
      const line = lines[index]
      if (line === undefined) continue
      try {
        const parsed: unknown = JSON.parse(line)
        assertStateEvent(parsed, runId, nextSeq)
        latest = parsed.state
        nextSeq += 1
      } catch (error) {
        if (index === nonEmptyIndices.at(-1) && !hasCompleteTrailingLine) {
          tornTrailingLine = true
          break
        }
        throw error
      }
    }
    if (latest === undefined) throw new Error('event log contains no complete state event')
    if (tornTrailingLine) {
      const completePrefix = text.slice(0, text.lastIndexOf('\n') + 1)
      await truncate(eventsPath, Buffer.byteLength(completePrefix))
      this.diagnostic(`run ${runId} had a torn trailing event; truncated it and recovered through seq ${nextSeq - 1}`)
    } else if (!hasCompleteTrailingLine) {
      await appendFile(eventsPath, '\n', { encoding: 'utf8', mode: 0o600 })
      this.diagnostic(`run ${runId} had a complete final event without a newline; normalized the append boundary`)
    }
    return new ArenaRunRecord(directory, latest, nextSeq, this.diagnostic)
  }

  private setupReportPath(workspaceId: string): string {
    const digest = createHash('sha256').update(workspaceId, 'utf8').digest('hex')
    return join(this.root, 'setup-reports', `${digest}.json`)
  }
}
