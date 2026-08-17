/** Deterministic pre-execution security screening and bounded review materialization. */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ResolvedConfig } from './config.ts'
import type { CapturedCandidate } from './git.ts'
import type { ArenaSecurityFinding } from './types.ts'
import { repositoryAbsolutePath } from './repository-path.ts'

interface AddedLine {
  path: string
  line: number
  text: string
}

const KNOWN_SECRET_RULES: Array<{ id: string; pattern: RegExp; message: string }> = [
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u, message: 'Private-key material was added.' },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u, message: 'An AWS access-key identifier was added.' },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/u, message: 'A GitHub token-shaped value was added.' },
  { id: 'openai-token', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u, message: 'An API token-shaped value was added.' },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u, message: 'A Slack token-shaped value was added.' },
]

const PLACEHOLDER = /(?:example|dummy|placeholder|changeme|your[_-]|<[^>]+>|process\.env|import\.meta\.env|\$\{)/iu
const CREDENTIAL_ASSIGNMENT =
  /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*["']?\s*[:=]\s*["']([^"']{12,})["']/iu

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function artifactPath(artifactDir: string, candidate: string): string {
  const root = resolve(artifactDir, 'untracked')
  return repositoryAbsolutePath(root, candidate)
}

function parseAddedPatchLines(patch: string): AddedLine[] {
  const result: AddedLine[] = []
  let path = '<tracked-patch>'
  let targetLine = 0
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      path = raw.slice('+++ b/'.length)
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw)
    if (hunk !== null) {
      targetLine = Number(hunk[1])
      continue
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      result.push({ path, line: targetLine, text: raw.slice(1) })
      targetLine += 1
    } else if (!raw.startsWith('-') && !raw.startsWith('diff ') && !raw.startsWith('index ')) {
      targetLine += 1
    }
  }
  return result
}

function finding(
  ruleId: string,
  severity: ArenaSecurityFinding['severity'],
  path: string,
  message: string,
  line?: number,
  sensitiveValue?: string,
): ArenaSecurityFinding {
  return {
    ruleId,
    severity,
    path,
    ...line === undefined ? {} : { line },
    message,
    ...sensitiveValue === undefined ? {} : { fingerprint: fingerprint(sensitiveValue) },
  }
}

function scanLine(item: AddedLine): ArenaSecurityFinding[] {
  const hits: ArenaSecurityFinding[] = []
  for (const rule of KNOWN_SECRET_RULES) {
    const match = rule.pattern.exec(item.text)
    if (match !== null) hits.push(finding(rule.id, 'critical', item.path, rule.message, item.line, match[0]))
  }
  const assigned = CREDENTIAL_ASSIGNMENT.exec(item.text)
  if (assigned?.[1] !== undefined && !PLACEHOLDER.test(assigned[1])) {
    hits.push(finding('literal-credential', 'critical', item.path, 'A literal credential-like value was added.', item.line, assigned[1]))
  }
  if (/(?:curl|wget)\b[^\n|;]*\|\s*(?:ba)?sh\b/iu.test(item.text)) {
    hits.push(finding('download-pipe-shell', 'high', item.path, 'Downloaded content is piped directly into a shell.', item.line))
  }
  if (/\bchmod\s+(?:-R\s+)?777\b/iu.test(item.text)) {
    hits.push(finding('world-writable', 'high', item.path, 'World-writable permissions were introduced.', item.line))
  }
  if (/\b(?:eval|exec)\s*\([^)]*(?:request|req\.|input|query|body|params)/iu.test(item.text)) {
    hits.push(finding('dynamic-execution', 'high', item.path, 'Dynamic execution appears to consume request-controlled input.', item.line))
  }
  if (/\b(?:child_process|os\.system|subprocess\.(?:run|Popen))\b/iu.test(item.text)) {
    hits.push(finding('process-execution', 'medium', item.path, 'The change introduces operating-system process execution.', item.line))
  }
  return hits
}

/** Scan exact added content before any candidate-controlled project command runs. */
export async function scanCandidateSecurity(
  captured: CapturedCandidate,
  artifactDir: string,
  config: ResolvedConfig,
): Promise<ArenaSecurityFinding[]> {
  const findings: ArenaSecurityFinding[] = []
  if (captured.evidence.changedFiles.length > config.maxChangedFiles) {
    findings.push(finding(
      'changed-file-limit', 'high', '<candidate>',
      `Candidate changes ${captured.evidence.changedFiles.length} paths; policy maximum is ${config.maxChangedFiles}.`,
    ))
  }
  for (const file of captured.evidence.changedFiles) {
    if (config.protectedPathPatterns.some(pattern => pattern.test(file.path))) {
      findings.push(finding('protected-path', 'critical', file.path, 'A protected credential/configuration path was changed.'))
    }
    if (file.binary && !config.allowBinaryFiles) {
      findings.push(finding('binary-change', 'high', file.path, 'Binary changes are not eligible for automatic promotion.'))
    }
  }

  if (/^(?:new|old) file mode 120000$/mu.test(captured.patch)) {
    findings.push(finding('tracked-symlink', 'high', '<tracked-patch>', 'Tracked symbolic-link changes are not eligible for automatic promotion.'))
  }
  if (/^(?:new|old) file mode 160000$/mu.test(captured.patch) || /^Subproject commit /mu.test(captured.patch)) {
    findings.push(finding('gitlink-change', 'high', '<tracked-patch>', 'Git submodule/gitlink changes are not eligible for automatic promotion.'))
  }

  const lines = parseAddedPatchLines(captured.patch)
  for (const artifact of captured.untracked) {
    const changed = captured.evidence.changedFiles.find(file => file.path === artifact.path)
    if (changed?.binary === true) continue
    if ((artifact.mode & 0o022) !== 0) {
      findings.push(finding('writable-artifact-mode', 'high', artifact.path, 'An untracked artifact is group- or world-writable.'))
    }
    const text = await readFile(artifactPath(artifactDir, artifact.path), 'utf8')
    text.split('\n').forEach((value, index) => lines.push({ path: artifact.path, line: index + 1, text: value }))
  }
  for (const line of lines) findings.push(...scanLine(line))

  const dedupe = new Map<string, ArenaSecurityFinding>()
  for (const item of findings) {
    const key = `${item.ruleId}\0${item.path}\0${item.line ?? 0}\0${item.fingerprint ?? ''}`
    dedupe.set(key, item)
  }
  return [...dedupe.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0) || left.ruleId.localeCompare(right.ruleId))
}

/** Materialize complete changed text for model review without silently truncating it. */
export async function buildReviewBundle(
  captured: CapturedCandidate,
  artifactDir: string,
  maxChars: number,
): Promise<string> {
  const sections: string[] = [`# Tracked patch\n${captured.patch || '(no tracked patch)'}`]
  for (const file of captured.evidence.changedFiles) {
    if (!file.untracked) continue
    if (file.binary) {
      sections.push(`# Untracked binary: ${file.path}\n(binary content omitted; deterministic policy decides eligibility)`)
      continue
    }
    sections.push(`# Untracked file: ${file.path}\n${await readFile(artifactPath(artifactDir, file.path), 'utf8')}`)
  }
  const bundle = sections.join('\n\n')
  if (bundle.length > maxChars) {
    throw new Error(`complete review bundle is ${bundle.length} characters; maxReviewInputChars is ${maxChars}`)
  }
  return bundle
}

/** Security findings at high/critical severity stop execution before candidate code runs. */
export function hasBlockingSecurityFinding(findings: readonly ArenaSecurityFinding[]): boolean {
  return findings.some(item => item.severity === 'critical' || item.severity === 'high')
}
