'use client'

import { create } from 'zustand'

/**
 * Page + node selection. Multi-select via `nodeIds: Set<string>`; the Navigator
 * and hotkeys read `pageId`; component interactions read `nodeIds`.
 *
 * Multi-page selection via `selectedPageIds: Set<string>` allows the Navigator
 * to select multiple pages for batch operations (process, delete, export).
 */
type SelectionState = {
  pageId: string | null
  nodeIds: Set<string>

  setPage: (id: string | null) => void
  select: (id: string, additive?: boolean) => void
  selectMany: (ids: string[]) => void
  deselect: (id: string) => void
  clear: () => void
  isSelected: (id: string) => boolean

  // Multi-page selection
  selectedPageIds: Set<string>
  setSelectedPages: (ids: string[]) => void
  togglePageSelection: (id: string) => void
  clearPageSelection: () => void
  isPageSelected: (id: string) => boolean
  hasMultiPageSelection: () => boolean
  extendPageSelection: (id: string, anchor: string, allIds: string[]) => void
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  pageId: null,
  nodeIds: new Set(),

  setPage: (id) =>
    set(() => ({
      pageId: id,
      // Clear selection when the page changes — node ids are page-scoped.
      nodeIds: new Set(),
    })),

  select: (id, additive) =>
    set((state) => {
      if (additive) {
        const next = new Set(state.nodeIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return { nodeIds: next }
      }
      return { nodeIds: new Set([id]) }
    }),

  selectMany: (ids) => set(() => ({ nodeIds: new Set(ids) })),

  deselect: (id) =>
    set((state) => {
      if (!state.nodeIds.has(id)) return state
      const next = new Set(state.nodeIds)
      next.delete(id)
      return { nodeIds: next }
    }),

  clear: () => set({ nodeIds: new Set() }),

  isSelected: (id) => get().nodeIds.has(id),

  // Multi-page selection
  selectedPageIds: new Set(),

  setSelectedPages: (ids) => set({ selectedPageIds: new Set(ids) }),

  togglePageSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedPageIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedPageIds: next }
    }),

  clearPageSelection: () => set({ selectedPageIds: new Set() }),

  isPageSelected: (id) => get().selectedPageIds.has(id),

  hasMultiPageSelection: () => get().selectedPageIds.size > 1,

  extendPageSelection: (id, anchor, allIds) =>
    set((state) => {
      const anchorIdx = allIds.indexOf(anchor)
      const clickIdx = allIds.indexOf(id)
      if (anchorIdx === -1 || clickIdx === -1) {
        const next = new Set(state.selectedPageIds)
        next.add(id)
        return { selectedPageIds: next }
      }
      const start = Math.min(anchorIdx, clickIdx)
      const end = Math.max(anchorIdx, clickIdx)
      const next = new Set(allIds.slice(start, end + 1))
      return { selectedPageIds: next }
    }),
}))
