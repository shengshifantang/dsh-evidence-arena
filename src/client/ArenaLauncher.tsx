/** Sidebar footer entry that opens the standalone Arena workbench. */

import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ArenaWorkbenchStore } from './stores.ts'
import css from './ArenaWorkbench.module.css'

export type ArenaLauncherProps =
  PropsRuntime<'sidebar.footer.action'> & PropsStore<ArenaWorkbenchStore> & PropsLocale<'arena'>

/** Render a wide footer row or compact rail action using the shell-owned width state. */
export function ArenaLauncher({ wide, useStore, actions, t }: ArenaLauncherProps) {
  const open = useStore(state => state.open)
  return (
    <div className={wide ? css.launcher : `${css.launcher} ${css.launcherRail}`}>
      <button
        type="button"
        className={css.launchButton}
        data-active={open || undefined}
        aria-label={t('workbench.open')}
        aria-expanded={open}
        onClick={() => { actions.toggle() }}
      >
        <span className={css.launchMark} aria-hidden>A/B</span>
        {wide && <span className={css.launchLabel}>{t('workbench.title')}</span>}
      </button>
    </div>
  )
}
