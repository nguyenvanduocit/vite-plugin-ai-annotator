/**
 * Toolbar placement: pure functions, no DOM access.
 *
 * The toolbar is anchored to the left or right screen edge by `inset` and to
 * the top by `top` (null = default bottom-right corner). Anchoring to a side
 * (not to an absolute x) keeps the toolbar glued to its edge when its width
 * changes (error state, Paseo button appearing, window resize).
 */

export type DockSide = 'left' | 'right'

export interface ToolbarLayout {
  side: DockSide
  /** Distance from the docked side, in px. Ignored for display while collapsed. */
  inset: number
  /** Distance from the viewport top in px; null = default bottom margin. */
  top: number | null
  collapsed: boolean
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  left: number
  right: number
  top: number
}

export const EDGE_MARGIN = 16
// Dropping within this distance of a side edge snaps to EDGE_MARGIN.
const SNAP_DISTANCE = 24

export const DEFAULT_LAYOUT: ToolbarLayout = { side: 'right', inset: EDGE_MARGIN, top: null, collapsed: false }

export const LAYOUT_STORAGE_KEY = 'ai-annotator:toolbar-layout'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** Parses untrusted stored JSON once at the boundary; anything malformed yields the default. */
export function parseLayout(raw: string | null): ToolbarLayout {
  if (!raw) return DEFAULT_LAYOUT
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return DEFAULT_LAYOUT
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_LAYOUT
  const { side, inset, top, collapsed } = value as Record<string, unknown>
  if (side !== 'left' && side !== 'right') return DEFAULT_LAYOUT
  if (typeof inset !== 'number' || !Number.isFinite(inset)) return DEFAULT_LAYOUT
  if (top !== null && (typeof top !== 'number' || !Number.isFinite(top))) return DEFAULT_LAYOUT
  if (typeof collapsed !== 'boolean') return DEFAULT_LAYOUT
  return { side, inset, top, collapsed }
}

/** Layout for an element dropped at `rect`: nearest side, edge-snapped. */
export function layoutFromRect(rect: Rect, viewport: Size, collapsed: boolean): ToolbarLayout {
  const side: DockSide = (rect.left + rect.right) / 2 < viewport.width / 2 ? 'left' : 'right'
  const rawInset = side === 'left' ? rect.left : viewport.width - rect.right
  const inset = rawInset < SNAP_DISTANCE ? EDGE_MARGIN : rawInset
  return { side, inset, top: rect.top, collapsed }
}

/** Keeps the element (of `size`) fully inside the viewport. */
export function fitLayout(layout: ToolbarLayout, size: Size, viewport: Size): ToolbarLayout {
  const inset = layout.collapsed ? layout.inset : clamp(layout.inset, 0, viewport.width - size.width)
  const top = layout.top === null ? null : clamp(layout.top, 0, viewport.height - size.height)
  return { ...layout, inset, top }
}

export function sameLayout(a: ToolbarLayout, b: ToolbarLayout): boolean {
  return a.side === b.side && a.inset === b.inset && a.top === b.top && a.collapsed === b.collapsed
}

/** Inline-style values for the fixed host element. */
export function hostPosition(layout: ToolbarLayout): Record<'left' | 'right' | 'top' | 'bottom', string> {
  const inset = layout.collapsed ? '0px' : `${layout.inset}px`
  return {
    left: layout.side === 'left' ? inset : 'auto',
    right: layout.side === 'right' ? inset : 'auto',
    top: layout.top === null ? 'auto' : `${layout.top}px`,
    bottom: layout.top === null ? `${EDGE_MARGIN}px` : 'auto',
  }
}
