/**
 * Package-owned invariant companion for `dsh-evidence-arena`.
 * @module dsh-evidence-arena/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-evidence-arena'

/** Cordis companion plugin name. */
export const name = 'arena-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Arena's durable event/state relation is private file
 * state, not a Cordis event relation. Store recovery and promotion tests own
 * that invariant.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership with the shared test/runtime registry. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
