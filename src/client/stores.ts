/** Shared root-scope viewing state for the Arena launcher and workbench. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

type ArenaWorkbenchView = 'runs' | 'setup'

export interface ArenaWorkbenchState {
  open: boolean
  view: ArenaWorkbenchView
  workspaceId: string | null
  runId: string | null
}

type ArenaWorkbenchActions = {
  setOpen: (draft: ArenaWorkbenchState, open: boolean) => void
  toggle: (draft: ArenaWorkbenchState) => void
  showView: (draft: ArenaWorkbenchState, view: ArenaWorkbenchView) => void
  selectWorkspace: (draft: ArenaWorkbenchState, workspaceId: string | null) => void
  selectRun: (draft: ArenaWorkbenchState, runId: string | null) => void
}

/** Create one handle in client apply world so both root slots share one instance. */
export function createArenaWorkbenchStore(): EngineStoreHandle<ArenaWorkbenchState, ArenaWorkbenchActions> {
  return defineStore({
    init: (): ArenaWorkbenchState => ({
      open: false,
      view: 'runs',
      workspaceId: null,
      runId: null,
    }),
    actions: {
      setOpen: (draft, open: boolean) => { draft.open = open },
      toggle: (draft) => { draft.open = !draft.open },
      showView: (draft, view: ArenaWorkbenchView) => { draft.view = view },
      selectWorkspace: (draft, workspaceId: string | null) => {
        if (draft.workspaceId === workspaceId) return
        draft.workspaceId = workspaceId
        draft.runId = null
      },
      selectRun: (draft, runId: string | null) => {
        draft.runId = runId
      },
    },
  })
}

export type ArenaWorkbenchStore = ReturnType<typeof createArenaWorkbenchStore>
