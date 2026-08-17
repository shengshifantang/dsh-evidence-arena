/** Full-width candidate tabs, file tree, and lazily loaded per-file unified diff. */

import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ArenaCandidateFileDiff,
  ArenaChangedFile,
  ArenaContenderState,
} from '../types.ts'
import type { ArenaCardFace } from './rpc.ts'
import css from './ArenaCard.module.css'

export interface UnifiedDiffRow {
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'del'
  oldLine?: number
  newLine?: number
  text: string
}

/** Parse enough of the unified format to display stable old/new line gutters. */
export function parseUnifiedDiffRows(diff: string): UnifiedDiffRow[] {
  const lines = diff.endsWith('\n') ? diff.slice(0, -1).split('\n') : diff.split('\n')
  if (lines.length === 1 && lines[0] === '') return []
  const rows: UnifiedDiffRow[] = []
  let oldLine: number | undefined
  let newLine: number | undefined
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line)
    if (hunk !== null) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ kind: 'hunk', text: line })
      continue
    }
    if (oldLine === undefined || newLine === undefined || line.startsWith('\\')) {
      rows.push({ kind: 'meta', text: line })
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', newLine, text: line })
      newLine += 1
      continue
    }
    if (line.startsWith('-')) {
      rows.push({ kind: 'del', oldLine, text: line })
      oldLine += 1
      continue
    }
    rows.push({ kind: 'context', oldLine, newLine, text: line })
    oldLine += 1
    newLine += 1
  }
  return rows
}

interface DirectoryNode {
  name: string
  path: string
  directories: Map<string, DirectoryNode>
  files: ArenaChangedFile[]
}

function fileTree(files: readonly ArenaChangedFile[]): DirectoryNode {
  const root: DirectoryNode = { name: '', path: '', directories: new Map(), files: [] }
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const parts = file.path.split('/')
    let directory = root
    for (const name of parts.slice(0, -1)) {
      const path = directory.path.length === 0 ? name : `${directory.path}/${name}`
      const existing = directory.directories.get(name)
      if (existing !== undefined) directory = existing
      else {
        const created: DirectoryNode = { name, path, directories: new Map(), files: [] }
        directory.directories.set(name, created)
        directory = created
      }
    }
    directory.files.push(file)
  }
  return root
}

function FileRows({
  directory,
  selectedPath,
  onSelect,
}: {
  directory: DirectoryNode
  selectedPath: string | undefined
  onSelect: (path: string) => void
}) {
  return (
    <ul className={css.diffTreeList}>
      {[...directory.directories.values()].map(child => (
        <li key={child.path} className={css.diffTreeDirectory}>
          <details open>
            <summary><span aria-hidden>▾</span> {child.name}</summary>
            <FileRows directory={child} selectedPath={selectedPath} onSelect={onSelect} />
          </details>
        </li>
      ))}
      {directory.files.map(file => (
        <li key={file.path}>
          <button
            type="button"
            className={css.diffTreeFile}
            data-selected={selectedPath === file.path || undefined}
            aria-pressed={selectedPath === file.path}
            onClick={() => { onSelect(file.path) }}
          >
            <span className={css.fileStatus}>{file.status}</span>
            <span className={css.diffTreeName}>{file.path.split('/').at(-1)}</span>
            <span className={css.fileDelta}>+{file.added} −{file.deleted}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function DiffRows({ artifact }: { artifact: ArenaCandidateFileDiff }) {
  const rows = useMemo(() => parseUnifiedDiffRows(artifact.diff), [artifact.diff])
  if (artifact.file.binary) {
    return <div className={css.diffEmpty}>Binary file · +{artifact.file.added} −{artifact.file.deleted}</div>
  }
  return (
    <div className={css.unifiedDiff} role="table" aria-label={artifact.file.path}>
      {rows.map((row, index) => (
        <div key={`${index}-${row.text}`} className={css.diffRow} data-kind={row.kind} role="row">
          <span className={css.diffLineNumber} role="cell">{row.oldLine ?? ''}</span>
          <span className={css.diffLineNumber} role="cell">{row.newLine ?? ''}</span>
          <code role="cell">{row.text.length === 0 ? ' ' : row.text}</code>
        </div>
      ))}
    </div>
  )
}

export function ArenaDiffReview({
  runId,
  contenders,
  winnerId,
  loadFileDiff,
  t,
}: {
  runId: string
  contenders: readonly ArenaContenderState[]
  winnerId: string | undefined
  loadFileDiff: ArenaCardFace['loadFileDiff']
  t: PropsLocale<'arena'>['t']
}) {
  const reviewable = useMemo(
    () => contenders.filter(contender => (contender.evidence?.changedFiles.length ?? 0) > 0),
    [contenders],
  )
  const initialId = reviewable.some(contender => contender.id === winnerId) ? winnerId : reviewable[0]?.id
  const [contenderId, setContenderId] = useState(initialId)
  const [selectedPath, setSelectedPath] = useState<string>()
  const [artifacts, setArtifacts] = useState<Record<string, ArenaCandidateFileDiff>>({})
  const [loadingKey, setLoadingKey] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (contenderId !== undefined && reviewable.some(contender => contender.id === contenderId)) return
    setContenderId(initialId)
    setSelectedPath(undefined)
  }, [contenderId, initialId, reviewable])

  const contender = reviewable.find(candidate => candidate.id === contenderId)
  const files = contender?.evidence?.changedFiles ?? []
  const tree = useMemo(() => fileTree(files), [files])
  const key = contenderId === undefined || selectedPath === undefined ? undefined : `${contenderId}\0${selectedPath}`
  const artifact = key === undefined ? undefined : artifacts[key]

  const selectContender = (nextId: string): void => {
    setContenderId(nextId)
    setSelectedPath(undefined)
    setError(undefined)
  }

  const selectFile = (path: string): void => {
    if (contenderId === undefined) return
    const nextKey = `${contenderId}\0${path}`
    setSelectedPath(path)
    setError(undefined)
    if (artifacts[nextKey] !== undefined) return
    setLoadingKey(nextKey)
    void loadFileDiff(runId, contenderId, path).then((value) => {
      setArtifacts(previous => ({ ...previous, [nextKey]: value }))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      setLoadingKey(current => current === nextKey ? undefined : current)
    })
  }

  if (reviewable.length === 0) return null
  return (
    <section className={css.codeReview} aria-label={t('codeReview.title')}>
      <header className={css.codeReviewHeader}>
        <div><h4>{t('codeReview.title')}</h4><p>{t('codeReview.subtitle')}</p></div>
        <div className={css.contenderTabs} role="tablist" aria-label={t('codeReview.candidates')}>
          {reviewable.map(candidate => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === contenderId}
              data-selected={candidate.id === contenderId || undefined}
              onClick={() => { selectContender(candidate.id) }}
            >
              <span>{candidate.label}</span>
              <small>{candidate.evidence?.changedFiles.length ?? 0}</small>
            </button>
          ))}
        </div>
      </header>
      <div className={css.diffWorkspace}>
        <nav className={css.diffTree} aria-label={t('codeReview.files')}>
          <div className={css.diffTreeHeader}>{t('codeReview.files')} <span>{files.length}</span></div>
          <FileRows directory={tree} selectedPath={selectedPath} onSelect={selectFile} />
        </nav>
        <div className={css.diffViewer} role="tabpanel">
          {selectedPath === undefined && <div className={css.diffEmpty}>{t('codeReview.selectFile')}</div>}
          {selectedPath !== undefined && loadingKey === key && <div className={css.diffEmpty}>{t('codeReview.loading')}</div>}
          {selectedPath !== undefined && error !== undefined && <div className={css.inlineError} role="alert">{error}</div>}
          {artifact !== undefined && (
            <>
              <div className={css.diffViewerHeader}>
                <code>{artifact.file.path}</code>
                <span>+{artifact.file.added} −{artifact.file.deleted}</span>
              </div>
              {artifact.truncated && (
                <div className={css.truncated}>{t('codeReview.truncated')} {artifact.totalChars.toLocaleString()}</div>
              )}
              <DiffRows artifact={artifact} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}
