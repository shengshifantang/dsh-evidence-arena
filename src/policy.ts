/** Repository policy parsing, canonical Ed25519 verification, and immutable run snapshots. */

import { constants } from 'node:fs'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { hostProjectPolicy, type ResolvedConfig } from './config.ts'
import { assertRepositoryContainment, normalizeRepositoryPath, repositoryAbsolutePath } from './repository-path.ts'
import {
  ARENA_POLICY_VERSION,
  type ArenaJudgeCommandConfig,
  type ArenaPolicyPackDocument,
  type ArenaPolicySnapshot,
  type ArenaProjectPolicyRules,
} from './types.ts'

const POLICY_FIELDS = ['schemaVersion', 'policyId', 'revision', 'rules', 'signature'] as const
const RULE_FIELDS = [
  'judgeCommands', 'requireChanges', 'requireProjectTests', 'requireLogicReview', 'requireSecurityReview',
  'allowBinaryFiles', 'maxChangedFiles', 'maxReviewInputChars', 'protectedPathPatterns', 'sharedContextPaths',
] as const
const COMMAND_FIELDS = ['id', 'label', 'stage', 'required', 'command', 'args', 'timeoutMs'] as const
const SIGNATURE_FIELDS = ['algorithm', 'keyId', 'value'] as const
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u
const COMMAND_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Deterministic Arena JSON encoding used as the signature payload. */
export function canonicalizeArenaPolicy(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalizeArenaPolicy(item)).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeArenaPolicy(item)}`)
    .join(',')}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(label: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length > 0) throw new Error(`${label} contains unknown field(s): ${unknown.join(', ')}`)
}

function requiredString(label: string, value: unknown, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.trim().length === 0 || (pattern !== undefined && !pattern.test(value))) {
    throw new Error(`${label} must be a non-empty${pattern === undefined ? '' : ' valid'} string`)
  }
  return value
}

function requiredBoolean(label: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function positiveInteger(label: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
  return value
}

function stringArray(label: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`${label} must be a string array`)
  return value
}

function parseCommands(value: unknown): ArenaJudgeCommandConfig[] {
  if (!Array.isArray(value)) throw new Error('policy rules.judgeCommands must be an array')
  const ids = new Set<string>()
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`policy judgeCommands[${index}] must be an object`)
    exactKeys(`policy judgeCommands[${index}]`, item, COMMAND_FIELDS)
    const id = requiredString(`policy judgeCommands[${index}].id`, item.id, COMMAND_ID_PATTERN)
    if (ids.has(id)) throw new Error(`policy judge command id ${id} is duplicated`)
    ids.add(id)
    if (item.stage !== 'quality' && item.stage !== 'test') {
      throw new Error(`policy judgeCommands[${index}].stage must be quality or test`)
    }
    return {
      id,
      label: requiredString(`policy judgeCommands[${index}].label`, item.label),
      stage: item.stage,
      required: requiredBoolean(`policy judgeCommands[${index}].required`, item.required),
      command: requiredString(`policy judgeCommands[${index}].command`, item.command),
      args: stringArray(`policy judgeCommands[${index}].args`, item.args),
      timeoutMs: positiveInteger(`policy judgeCommands[${index}].timeoutMs`, item.timeoutMs),
    }
  })
}

function parseRules(value: unknown): ArenaProjectPolicyRules {
  if (!isRecord(value)) throw new Error('policy rules must be an object')
  exactKeys('policy rules', value, RULE_FIELDS)
  const protectedPathPatterns = stringArray('policy rules.protectedPathPatterns', value.protectedPathPatterns)
  for (const [index, source] of protectedPathPatterns.entries()) {
    if (source.length === 0) throw new Error(`policy protectedPathPatterns[${index}] must not be empty`)
    try { new RegExp(source, 'iu') } catch (error) {
      throw new Error(`policy protectedPathPatterns[${index}] is invalid`, { cause: error })
    }
  }
  const sharedContextPaths = stringArray('policy rules.sharedContextPaths', value.sharedContextPaths)
    .map(normalizeRepositoryPath)
  if (new Set(sharedContextPaths).size !== sharedContextPaths.length) {
    throw new Error('policy rules.sharedContextPaths contains a duplicate path')
  }
  return {
    judgeCommands: parseCommands(value.judgeCommands),
    requireChanges: requiredBoolean('policy rules.requireChanges', value.requireChanges),
    requireProjectTests: requiredBoolean('policy rules.requireProjectTests', value.requireProjectTests),
    requireLogicReview: requiredBoolean('policy rules.requireLogicReview', value.requireLogicReview),
    requireSecurityReview: requiredBoolean('policy rules.requireSecurityReview', value.requireSecurityReview),
    allowBinaryFiles: requiredBoolean('policy rules.allowBinaryFiles', value.allowBinaryFiles),
    maxChangedFiles: positiveInteger('policy rules.maxChangedFiles', value.maxChangedFiles),
    maxReviewInputChars: positiveInteger('policy rules.maxReviewInputChars', value.maxReviewInputChars),
    protectedPathPatterns,
    sharedContextPaths,
  }
}

/** Parse one hostile repository policy document without accepting unknown semantics. */
export function parseArenaPolicy(value: unknown): ArenaPolicyPackDocument {
  if (!isRecord(value)) throw new Error('Arena policy pack must be a JSON object')
  exactKeys('Arena policy pack', value, POLICY_FIELDS)
  if (value.schemaVersion !== ARENA_POLICY_VERSION) {
    throw new Error(`Arena policy schemaVersion must be ${ARENA_POLICY_VERSION}`)
  }
  let signature: ArenaPolicyPackDocument['signature']
  if (value.signature !== undefined) {
    if (!isRecord(value.signature)) throw new Error('policy signature must be an object')
    exactKeys('policy signature', value.signature, SIGNATURE_FIELDS)
    if (value.signature.algorithm !== 'ed25519') throw new Error('policy signature.algorithm must be ed25519')
    const encoded = requiredString('policy signature.value', value.signature.value)
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || Buffer.from(encoded, 'base64').byteLength !== 64) {
      throw new Error('policy signature.value must be one base64-encoded Ed25519 signature')
    }
    signature = {
      algorithm: 'ed25519',
      keyId: requiredString('policy signature.keyId', value.signature.keyId, ID_PATTERN),
      value: encoded,
    }
  }
  return {
    schemaVersion: ARENA_POLICY_VERSION,
    policyId: requiredString('policyId', value.policyId, ID_PATTERN),
    revision: requiredString('revision', value.revision, ID_PATTERN),
    rules: parseRules(value.rules),
    ...signature === undefined ? {} : { signature },
  }
}

function signingPayload(document: ArenaPolicyPackDocument): string {
  return canonicalizeArenaPolicy({
    schemaVersion: document.schemaVersion,
    policyId: document.policyId,
    revision: document.revision,
    rules: document.rules as unknown as JsonValue,
  })
}

/** SHA-256 digest of the exact canonical payload covered by a policy signature. */
export function arenaPolicyDigest(document: ArenaPolicyPackDocument): string {
  return createHash('sha256').update(signingPayload(document)).digest('hex')
}

/** Render an unsigned, complete repository policy from the Host fallback rules. */
export function arenaPolicyTemplate(config: ResolvedConfig): string {
  const document: ArenaPolicyPackDocument = {
    schemaVersion: ARENA_POLICY_VERSION,
    policyId: 'project-arena-policy',
    revision: '1',
    rules: hostProjectPolicy(config),
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

async function boundedPolicyRead(path: string, maxBytes: number): Promise<string> {
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const handle = await open(path, constants.O_RDONLY | noFollow)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Arena policy path is not a regular file: ${path}`)
    if (stat.size > maxBytes) throw new Error(`Arena policy exceeds policyPackMaxBytes (${maxBytes})`)
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

function hostSnapshot(config: ResolvedConfig): ArenaPolicySnapshot {
  const document: ArenaPolicyPackDocument = {
    schemaVersion: ARENA_POLICY_VERSION,
    policyId: 'host-config',
    revision: 'runtime',
    rules: hostProjectPolicy(config),
  }
  return {
    source: 'host-config',
    policyId: document.policyId,
    revision: document.revision,
    digest: arenaPolicyDigest(document),
    signature: { status: 'ignored' },
    rules: document.rules,
  }
}

/** Policy resolution facts used by preflight, setup, and immutable run admission. */
export interface ArenaPolicyResolution {
  snapshot: ArenaPolicySnapshot
  blockers: string[]
  warnings: string[]
  policyText: string
  loadedPolicyDigest?: string
  policyPath?: string
}

/** Resolve and verify the repository policy; an invalid present file never falls back silently. */
export async function resolveArenaPolicy(
  config: ResolvedConfig,
  repoRoot?: string,
): Promise<ArenaPolicyResolution> {
  const fallback = hostSnapshot(config)
  const template = arenaPolicyTemplate(config)
  if (repoRoot === undefined) {
    return {
      snapshot: fallback,
      blockers: config.policyPackMode === 'required' ? ['repository policy is required but no workspace was supplied'] : [],
      warnings: config.policyPackMode === 'optional' ? ['repository policy was not evaluated because no workspace was supplied'] : [],
      policyText: template,
    }
  }
  const relativePath = normalizeRepositoryPath(config.policyPackPath)
  const policyPath = repositoryAbsolutePath(repoRoot, relativePath)
  try {
    await assertRepositoryContainment(repoRoot, policyPath)
    const text = await boundedPolicyRead(policyPath, config.policyPackMaxBytes)
    const document = parseArenaPolicy(JSON.parse(text) as unknown)
    const digest = arenaPolicyDigest(document)
    const documentDigest = createHash('sha256').update(text).digest('hex')
    let signature: ArenaPolicySnapshot['signature'] = { status: 'not-present' }
    if (config.policySignatureMode === 'off') {
      signature = { status: 'ignored', ...document.signature === undefined ? {} : { keyId: document.signature.keyId } }
    } else if (document.signature !== undefined) {
      const publicKey = config.policyTrustedKeys[document.signature.keyId]
      if (publicKey === undefined) {
        signature = { status: 'untrusted-key', keyId: document.signature.keyId }
      } else {
        const valid = verify(
          null,
          Buffer.from(signingPayload(document)),
          createPublicKey(publicKey),
          Buffer.from(document.signature.value, 'base64'),
        )
        signature = { status: valid ? 'verified' : 'invalid', keyId: document.signature.keyId }
      }
    }
    const snapshot: ArenaPolicySnapshot = {
      source: 'repository',
      path: relativePath,
      policyId: document.policyId,
      revision: document.revision,
      digest,
      signature,
      rules: document.rules,
    }
    const signatureProblem = signature.status !== 'verified' && signature.status !== 'ignored'
    const detail = `repository policy ${relativePath} signature status is ${signature.status}`
    return {
      snapshot,
      blockers: signatureProblem && config.policySignatureMode === 'require' ? [detail] : [],
      warnings: signatureProblem && config.policySignatureMode === 'warn' ? [detail] : [],
      policyText: text,
      loadedPolicyDigest: documentDigest,
      policyPath: relativePath,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        snapshot: fallback,
        blockers: config.policyPackMode === 'required' ? [`repository policy is missing: ${relativePath}`] : [],
        warnings: config.policyPackMode === 'optional' ? [`repository policy is absent; Host fallback rules apply: ${relativePath}`] : [],
        policyText: template,
        policyPath: relativePath,
      }
    }
    return {
      snapshot: fallback,
      blockers: [`repository policy ${relativePath} is invalid: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
      policyText: template,
      policyPath: relativePath,
    }
  }
}

/** Validate and atomically write one wizard-edited policy without overwriting an unseen revision. */
export async function writeArenaPolicy(
  config: ResolvedConfig,
  repoRoot: string,
  text: string,
  expectedDigest?: string,
): Promise<ArenaPolicySnapshot> {
  if (Buffer.byteLength(text) > config.policyPackMaxBytes) {
    throw new Error(`Arena policy exceeds policyPackMaxBytes (${config.policyPackMaxBytes})`)
  }
  const document = parseArenaPolicy(JSON.parse(text) as unknown)
  const relativePath = normalizeRepositoryPath(config.policyPackPath)
  const target = repositoryAbsolutePath(repoRoot, relativePath)
  await assertRepositoryContainment(repoRoot, target)
  try {
    const existingText = await readFile(target, 'utf8')
    parseArenaPolicy(JSON.parse(existingText) as unknown)
    const existingDigest = createHash('sha256').update(existingText).digest('hex')
    if (expectedDigest === undefined) throw new Error(`repository policy already exists: ${relativePath}`)
    if (existingDigest !== expectedDigest) throw new Error('repository policy changed after the setup report was loaded')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (expectedDigest !== undefined) throw new Error('repository policy was removed after the setup report was loaded')
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await assertRepositoryContainment(repoRoot, target)
  await writeFileAtomic(target, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  const resolved = await resolveArenaPolicy(config, repoRoot)
  if (resolved.snapshot.source !== 'repository') throw new Error('written repository policy could not be reloaded')
  return resolved.snapshot
}
