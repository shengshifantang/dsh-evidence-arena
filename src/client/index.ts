/** Evidence Arena Web face: stock-DSH sidebar launcher and global workbench. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ArenaLauncher } from './ArenaLauncher.tsx'
import { ArenaWorkbench } from './ArenaWorkbench.tsx'
import { arenaCardFace } from './rpc.ts'
import { createArenaWorkbenchStore } from './stores.ts'
import { en, NS, zh } from './locales.ts'

export { ArenaCard } from './ArenaCard.tsx'
export { ArenaLauncher } from './ArenaLauncher.tsx'
export { ArenaWorkbench } from './ArenaWorkbench.tsx'
export type { ArenaCardFace } from './rpc.ts'

export const inject = ['slots', 'locale', 'connection']

/** Register one additive launcher and overlay without owning or mutating chat Sessions. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const workbenchStore = createArenaWorkbenchStore()
  const face = () => arenaCardFace(connection.rpc, connection.isLoopback)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'arena: browser dictionaries')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'evidence-arena',
    locale: NS,
    store: workbenchStore,
  }, ArenaLauncher))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'evidence-arena-workbench',
    locale: NS,
    store: workbenchStore,
    inject: face,
  }, ArenaWorkbench))
}
