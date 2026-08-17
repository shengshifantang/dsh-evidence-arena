import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.ts'
import {
  arenaPolicyDigest,
  arenaPolicyTemplate,
  canonicalizeArenaPolicy,
  parseArenaPolicy,
  resolveArenaPolicy,
  writeArenaPolicy,
} from '../src/policy.ts'
import type { ArenaPolicyPackDocument } from '../src/types.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

async function repository(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-arena-policy-${label}-`))
  roots.push(root)
  return root
}

function config(root: string, overrides: Partial<ReturnType<typeof Config>> = {}) {
  return resolveConfig(Config({
    stateRoot: join(root, '.state'),
    requireProjectTests: false,
    policyPackMode: 'required',
    policySignatureMode: 'require',
    ...overrides,
  } as never))
}

async function writePolicy(root: string, text: string): Promise<void> {
  const target = join(root, '.dsh', 'arena-policy.json')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text)
}

function signedDocument(root: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const baseConfig = config(root, { policySignatureMode: 'off' })
  const document = parseArenaPolicy(JSON.parse(arenaPolicyTemplate(baseConfig)) as unknown)
  const payload = canonicalizeArenaPolicy(document as unknown as never)
  const signature = sign(null, Buffer.from(payload), privateKey).toString('base64')
  const signed: ArenaPolicyPackDocument = {
    ...document,
    signature: { algorithm: 'ed25519', keyId: 'release-key', value: signature },
  }
  return {
    signed,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

describe('repository Arena policy packs', () => {
  it('verifies a versioned Ed25519 policy and freezes the signed payload digest', async () => {
    const root = await repository('signed')
    const { signed, publicKey } = signedDocument(root)
    await writePolicy(root, `${JSON.stringify(signed, null, 2)}\n`)
    const resolved = await resolveArenaPolicy(config(root, {
      policyTrustedKeys: { 'release-key': publicKey },
    }), root)

    expect(resolved.blockers).toEqual([])
    expect(resolved.snapshot).toMatchObject({
      source: 'repository', policyId: 'project-arena-policy', revision: '1',
      signature: { status: 'verified', keyId: 'release-key' },
    })
    expect(resolved.snapshot.digest).toBe(arenaPolicyDigest(signed))
  })

  it('fails closed for tampered, untrusted, invalid, and missing required policies', async () => {
    const root = await repository('fail-closed')
    const { signed, publicKey } = signedDocument(root)
    signed.rules.requireChanges = !signed.rules.requireChanges
    await writePolicy(root, `${JSON.stringify(signed, null, 2)}\n`)
    const tampered = await resolveArenaPolicy(config(root, {
      policyTrustedKeys: { 'release-key': publicKey },
    }), root)
    expect(tampered.blockers).toEqual([expect.stringContaining('signature status is invalid')])

    const untrusted = await resolveArenaPolicy(config(root), root)
    expect(untrusted.blockers).toEqual([expect.stringContaining('untrusted-key')])

    await writePolicy(root, '{"schemaVersion":1,"unknown":true}\n')
    const invalid = await resolveArenaPolicy(config(root), root)
    expect(invalid.blockers).toEqual([expect.stringContaining('contains unknown field')])
    expect(invalid.snapshot.source).toBe('host-config')

    await rm(join(root, '.dsh', 'arena-policy.json'))
    const missing = await resolveArenaPolicy(config(root), root)
    expect(missing.blockers).toEqual([expect.stringContaining('policy is missing')])
  })

  it('writes only validated JSON and refuses to overwrite a signature-only concurrent change', async () => {
    const root = await repository('wizard')
    const resolvedConfig = config(root, { policySignatureMode: 'off' })
    const template = arenaPolicyTemplate(resolvedConfig)
    const first = await writeArenaPolicy(resolvedConfig, root, template)
    expect(first.source).toBe('repository')

    const loaded = await resolveArenaPolicy(resolvedConfig, root)
    const samePolicyWithDifferentBytes = `\n${await readFile(join(root, '.dsh', 'arena-policy.json'), 'utf8')}`
    await writeFile(join(root, '.dsh', 'arena-policy.json'), samePolicyWithDifferentBytes)
    await expect(writeArenaPolicy(
      resolvedConfig,
      root,
      loaded.policyText,
      loaded.loadedPolicyDigest,
    )).rejects.toThrow('changed after the setup report was loaded')

    await expect(writeArenaPolicy(resolvedConfig, root, '{"schemaVersion":1}', undefined))
      .rejects.toThrow(/unknown field|policyId/iu)
  })
})
