/** Source-shaped browser-runtime test seam; published DSH client entries are loader factories. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

type StoreDecl<T, A extends Record<string, (draft: T, ...args: never[]) => void>> = {
  init(): T
  actions: A
  persist?: string
}

/** Minimal source-compatible store used only by the standalone Vitest lane. */
export function defineStore<T, A extends Record<string, (draft: T, ...args: never[]) => void>>(
  declaration: StoreDecl<T, A>,
) {
  return {
    spec: declaration,
    create() {
      let state = declaration.init()
      const listeners = new Set<() => void>()
      const actions: Record<string, (...args: unknown[]) => void> = {}
      for (const [name, mutate] of Object.entries(declaration.actions)) {
        actions[name] = (...args: unknown[]) => {
          const draft = structuredClone(state)
          ;(mutate as (value: T, ...params: unknown[]) => void)(draft, ...args)
          state = draft
          for (const listener of [...listeners]) listener()
        }
      }
      return {
        actions,
        getSnapshot: () => state,
        subscribe(listener: () => void) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        clearPersisted() {},
      }
    },
  }
}

/** SlotCore-backed service preserving declaration waits and Cordis fiber disposal. */
export class SlotRegistry extends Service {
  private readonly core = new SlotCore()

  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  register(options: Record<string, unknown>, component: unknown): () => void {
    const dispose = this.core.register(options as never, component as never)
    this.ctx.effect(() => dispose, 'test slots: registration')
    return dispose
  }

  inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void {
    const disposeEffect = this.ctx.effect(() => {
      let active: (() => void) | undefined
      const reconcile = () => {
        const declared = this.core.spec(key as never) !== undefined
        if (declared && active === undefined) {
          const result = callback()
          if (typeof result === 'function') active = result
          else {
            const disposers = [...result]
            active = () => { for (const dispose of disposers.reverse()) dispose() }
          }
        } else if (!declared && active !== undefined) {
          active()
          active = undefined
        }
      }
      const unsubscribe = this.core.subscribeDeclaration(key, reconcile)
      reconcile()
      return () => {
        unsubscribe()
        active?.()
      }
    }, `test slots: inject ${key}`)
    return () => { void disposeEffect() }
  }

  entries(key: string) {
    return this.core.entries(key as never)
  }
}
