'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { LayoutGridIcon, Trash2Icon } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PageManagerDialog } from '@/components/PageManagerDialog'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useScene } from '@/hooks/useScene'
import { getConfig, getGetPageThumbnailUrl, startPipeline } from '@/lib/api/default/default'
import type { Page } from '@/lib/api/schemas'
import { applyOp } from '@/lib/io/scene'
import { ops } from '@/lib/ops'
import { useEditorUiStore } from '@/lib/stores/editorUiStore'
import { usePreferencesStore } from '@/lib/stores/preferencesStore'
import { useSelectionStore } from '@/lib/stores/selectionStore'

const THUMBNAIL_DPR =
  typeof window !== 'undefined' ? Math.min(Math.ceil(window.devicePixelRatio || 1), 3) : 2

const ROW_HEIGHT = 230
const OVERSCAN = 5

/** Module-level anchor for shift-click range selection. */
let _shiftAnchorId: string | null = null

export function Navigator() {
  const { scene } = useScene()
  const pagesMap = scene?.pages
  const pages = useMemo(() => (pagesMap ? Object.values(pagesMap) : []), [pagesMap])
  const pageIds = useMemo(() => pages.map((p) => p.id), [pages])
  const totalPages = pages.length
  const pageId = useSelectionStore((s) => s.pageId)
  const selectedPageIds = useSelectionStore((s) => s.selectedPageIds)
  const clearPageSelection = useSelectionStore((s) => s.clearPageSelection)
  const currentIndex = pages.findIndex((p) => p.id === pageId)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const { t } = useTranslation()
  const [pageManagerOpen, setPageManagerOpen] = useState(false)

  const virtualizer = useVirtualizer({
    count: totalPages,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  const handlePanelClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) clearPageSelection()
    },
    [clearPageSelection],
  )

  const handleDeleteSelected = useCallback(() => {
    void deleteSelectedPages(pages, selectedPageIds)
  }, [pages, selectedPageIds])

  return (
    <div
      data-testid='navigator-panel'
      data-total-pages={totalPages}
      className='flex h-full min-h-0 w-full flex-col bg-muted/50'
    >
      <div className='flex items-center justify-between border-b border-border px-2 py-1.5'>
        <div>
          <p className='text-xs tracking-wide text-muted-foreground uppercase'>
            {t('navigator.title')}
          </p>
          <p className='text-xs font-semibold text-foreground'>
            {totalPages ? t('navigator.pages', { count: totalPages }) : t('navigator.empty')}
          </p>
        </div>
        <div className='flex items-center gap-1'>
          {selectedPageIds.size > 1 && (
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6 text-destructive hover:text-destructive'
              onClick={handleDeleteSelected}
              title={t('navigator.deleteSelected')}
            >
              <Trash2Icon className='h-3.5 w-3.5' />
            </Button>
          )}
          {totalPages > 1 && (
            <Button
              variant='ghost'
              size='icon'
              data-testid='navigator-manage-pages'
              className='h-6 w-6'
              onClick={() => setPageManagerOpen(true)}
              title={t('navigator.pageManager.title')}
            >
              <LayoutGridIcon className='h-3.5 w-3.5' />
            </Button>
          )}
        </div>
      </div>

      <div className='flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground'>
        {totalPages > 0 ? (
          <span className='bg-secondary px-2 py-0.5 font-mono text-[10px] text-secondary-foreground'>
            {selectedPageIds.size > 1
              ? t('navigator.nSelected', { count: selectedPageIds.size })
              : `#${currentIndex + 1}`}
          </span>
        ) : (
          <span>{t('navigator.prompt')}</span>
        )}
      </div>

      <ScrollArea className='min-h-0 flex-1' viewportRef={viewportRef} onClick={handlePanelClick}>
        <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const page = pages[virtualRow.index]
            return (
              <div
                key={page?.id ?? virtualRow.index}
                className='absolute left-0 w-full px-1.5 pb-1'
                style={{
                  height: ROW_HEIGHT,
                  top: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <PagePreview
                  index={virtualRow.index}
                  page={page}
                  pages={pages}
                  isCurrentPage={page?.id === pageId}
                  isMultiSelected={page ? selectedPageIds.has(page.id) : false}
                />
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <PageManagerDialog open={pageManagerOpen} onOpenChange={setPageManagerOpen} />
    </div>
  )
}

async function deleteSelectedPages(pages: Page[], selectedIds: Set<string>): Promise<void> {
  const toRemove = pages.filter((p) => selectedIds.has(p.id))
  if (toRemove.length === 0) return
  const pageIndices = pages.map((p) => p.id)
  const opsToApply: import('@/lib/api/schemas').Op[] = toRemove.map((p) => {
    const idx = pageIndices.indexOf(p.id)
    return ops.removePage(p.id, p, idx)
  })
  await applyOp(ops.batch(`Delete ${toRemove.length} page(s)`, opsToApply))
}

async function processPages(pageIds: string[]): Promise<void> {
  const cfg = await getConfig()
  if (!cfg.pipeline) return
  const p = cfg.pipeline
  const steps = [
    p.detector,
    p.segmenter,
    p.bubble_segmenter,
    p.font_detector,
    p.ocr,
    p.translator,
    p.inpainter,
    p.renderer,
  ].filter((s): s is string => !!s)
  const editor = useEditorUiStore.getState()
  const prefs = usePreferencesStore.getState()
  const ctxPages = prefs.translationContextPages
  await startPipeline({
    steps,
    pages: pageIds,
    targetLanguage: editor.selectedLanguage,
    systemPrompt: prefs.customSystemPrompt,
    defaultFont: prefs.defaultFont,
    translationContextPages:
      ctxPages !== undefined && ctxPages > 0
        ? ctxPages === -1
          ? 4294967295
          : ctxPages
        : undefined,
  })
}

// ---------------------------------------------------------------------------
// PagePreview
// ---------------------------------------------------------------------------

type PagePreviewProps = {
  index: number
  page?: Page
  pages: Page[]
  isCurrentPage: boolean
  isMultiSelected: boolean
}

function PagePreview({
  index,
  page,
  pages,
  isCurrentPage,
  isMultiSelected,
}: PagePreviewProps) {
  const { t } = useTranslation()
  const setPage = useSelectionStore((s) => s.setPage)
  const togglePageSelection = useSelectionStore((s) => s.togglePageSelection)
  const clearPageSelection = useSelectionStore((s) => s.clearPageSelection)
  const extendPageSelection = useSelectionStore((s) => s.extendPageSelection)
  const selectedPageIds = useSelectionStore((s) => s.selectedPageIds)
  const src = page?.id
    ? `${getGetPageThumbnailUrl(page.id)}?size=${200 * THUMBNAIL_DPR}`
    : undefined

  const pageIds = useMemo(() => pages.map((p) => p.id), [pages])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!page) return
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation()
        _shiftAnchorId = page.id
        togglePageSelection(page.id)
        return
      }
      if (e.shiftKey) {
        e.stopPropagation()
        const anchor = _shiftAnchorId ?? useSelectionStore.getState().pageId ?? page.id
        _shiftAnchorId = anchor
        extendPageSelection(page.id, anchor, pageIds)
        return
      }
      _shiftAnchorId = null
      clearPageSelection()
      setPage(page.id)
    },
    [page, pageIds, setPage, togglePageSelection, clearPageSelection, extendPageSelection],
  )

  const handleProcess = useCallback(() => {
    if (!page) return
    const ids = isMultiSelected ? [...selectedPageIds] : [page.id]
    void processPages(ids)
  }, [page, isMultiSelected, selectedPageIds])

  const handleDelete = useCallback(() => {
    if (!page) return
    const ids = isMultiSelected ? [...selectedPageIds] : [page.id]
    const opsToApply = ids.map((id) => {
      const idx = pages.findIndex((p) => p.id === id)
      const p = pages.find((p) => p.id === id)
      return ops.removePage(id, p ?? page, idx >= 0 ? idx : 0)
    })
    void applyOp(ops.batch(`Delete ${ids.length} page(s)`, opsToApply))
  }, [page, pages, isMultiSelected, selectedPageIds])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button
          variant='ghost'
          onClick={handleClick}
          data-testid={`navigator-page-${index}`}
          data-page-index={index}
          data-selected={isCurrentPage || isMultiSelected}
          className='flex h-full w-full flex-col gap-0.5 rounded border bg-card p-1.5 text-left shadow-sm data-[selected=true]:border-primary'
          style={{
            borderColor: isMultiSelected ? 'var(--primary)' : undefined,
          }}
        >
          <div className='flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded'>
            {src ? (
              <img
                src={src}
                alt={`Page ${index + 1}`}
                loading='lazy'
                className='max-h-full max-w-full rounded object-contain'
              />
            ) : (
              <div className='h-full w-full rounded bg-muted' />
            )}
          </div>
          <div className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'>
            {isMultiSelected && (
              <div className='flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground'>
                ✓
              </div>
            )}
            <div className='mx-auto font-semibold text-foreground'>{index + 1}</div>
          </div>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent className='min-w-40'>
        <ContextMenuItem onSelect={handleProcess}>
          {isMultiSelected
            ? t('navigator.processSelected', { count: selectedPageIds.size })
            : t('navigator.processPage')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={handleDelete}
          className='text-destructive focus:text-destructive'
        >
          {isMultiSelected
            ? t('navigator.deleteSelected', { count: selectedPageIds.size })
            : t('navigator.deletePage')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
