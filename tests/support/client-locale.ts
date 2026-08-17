/** Source-shaped locale test seam; the published client entry is a DSH loader factory. */
import type { Context } from '@deepseek-ai/cordis'

type Dictionary = Record<string, string>

export class LocaleRuntime {
  private readonly dictionaries = new Map<string, Record<string, Dictionary>>()

  constructor(_ctx: Context) {}

  register(namespace: string, dictionaries: Record<string, Dictionary>): () => void {
    if (this.dictionaries.has(namespace)) throw new Error(`duplicate locale namespace: ${namespace}`)
    this.dictionaries.set(namespace, dictionaries)
    return () => { this.dictionaries.delete(namespace) }
  }

  bind(namespace: string) {
    return (key: string) => this.dictionaries.get(namespace)?.en?.[key]
      ?? this.dictionaries.get(namespace)?.zh?.[key]
      ?? key
  }
}
