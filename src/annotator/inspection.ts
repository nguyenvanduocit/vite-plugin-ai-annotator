/**
 * Inspection Manager for mouse inspection mode handling
 * Supports both single-click selection and drag-to-select multiple elements
 */

import { Z_INDEX, COLORS } from './constants'

export interface InspectionManager {
  enterInspectionMode(): void
  exitInspectionMode(): void
  isInInspectionMode(): boolean
  destroy(): void
}

export interface InspectionCallbacks {
  onElementSelect?: (element: Element) => void
  onMultiSelect?: (elements: Element[]) => void
  onTextSelect?: (range: Range, commonAncestor: Element) => void
  shouldIgnoreElement?: (element: Element) => boolean
  isElementSelected?: (element: Element) => boolean
  onEscape?: () => void
  onCopy?: () => void
}

interface DragState {
  isDragging: boolean
  startX: number
  startY: number
  currentX: number
  currentY: number
}

const DRAG_THRESHOLD = 5 // Minimum pixels to consider it a drag vs click
const INITIAL_DRAG_STATE: DragState = { isDragging: false, startX: 0, startY: 0, currentX: 0, currentY: 0 }

export function createInspectionManager(callbacks: InspectionCallbacks = {}): InspectionManager {
  const { onElementSelect, onMultiSelect, onTextSelect, shouldIgnoreElement, isElementSelected, onEscape, onCopy } = callbacks
  let isInspecting = false
  let currentHoveredElement: Element | null = null
  let hoverOverlay: HTMLDivElement | null = null
  let hoverKeyframesStyleElement: HTMLStyleElement | null = null
  let selectionOverlay: HTMLDivElement | null = null
  let glassPane: HTMLDivElement | null = null
  let dragState: DragState = { ...INITIAL_DRAG_STATE }
  let mouseDownTime = 0

  function createGlassPane(): HTMLDivElement {
    const pane = document.createElement('div')
    pane.id = 'annotator-glass-pane'
    pane.className = 'annotator-ignore'
    pane.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: transparent;
      cursor: crosshair;
      z-index: ${Z_INDEX.INSPECTION_OVERLAY};
      pointer-events: auto;
    `

    // Attach listeners to glass pane instead of document
    pane.addEventListener('mousedown', handleMouseDown, true)
    pane.addEventListener('mousemove', handleMouseMove, true)
    pane.addEventListener('mouseup', handleMouseUp, true)
    pane.addEventListener('click', preventClick, true)
    pane.addEventListener('dblclick', preventMouseEvents, true)
    pane.addEventListener('contextmenu', preventMouseEvents, true)

    document.body.appendChild(pane)
    return pane
  }

  function removeGlassPane(): void {
    if (glassPane) {
      glassPane.remove()
      glassPane = null
    }
  }

  function removeHoverHighlight(): void {
    if (hoverOverlay) {
      hoverOverlay.remove()
      hoverOverlay = null
    }
    currentHoveredElement = null
  }

  function createHoverOverlay(element: Element): HTMLDivElement {
    // Add keyframes animation if not already added (track for cleanup)
    if (!hoverKeyframesStyleElement) {
      hoverKeyframesStyleElement = document.createElement('style')
      hoverKeyframesStyleElement.id = 'annotator-hover-keyframes'
      hoverKeyframesStyleElement.textContent = `
        @keyframes hover-marching-ants {
          0% { background-position: 0 0, 100% 100%, 0 100%, 100% 0; }
          100% { background-position: 20px 0, calc(100% - 20px) 100%, 0 calc(100% - 20px), 100% 20px; }
        }
      `
      document.head.appendChild(hoverKeyframesStyleElement)
    }

    const color = COLORS.INSPECTION
    const overlay = document.createElement('div')
    overlay.className = 'annotator-hover-overlay'
    const rect = element.getBoundingClientRect()

    overlay.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      box-sizing: border-box;
      pointer-events: none;
      z-index: ${Z_INDEX.HOVER_OVERLAY};
      border-radius: 4px;
      background:
        linear-gradient(90deg, ${color} 50%, transparent 50%) repeat-x top left / 10px 2px,
        linear-gradient(90deg, ${color} 50%, transparent 50%) repeat-x bottom left / 10px 2px,
        linear-gradient(0deg, ${color} 50%, transparent 50%) repeat-y top left / 2px 10px,
        linear-gradient(0deg, ${color} 50%, transparent 50%) repeat-y top right / 2px 10px;
      animation: hover-marching-ants 0.4s linear infinite;
    `
    document.body.appendChild(overlay)
    return overlay
  }

  function updateHoverOverlay(element: Element): void {
    if (!hoverOverlay) return
    const rect = element.getBoundingClientRect()
    hoverOverlay.style.left = `${rect.left}px`
    hoverOverlay.style.top = `${rect.top}px`
    hoverOverlay.style.width = `${rect.width}px`
    hoverOverlay.style.height = `${rect.height}px`
  }

  function getElementAtPoint(x: number, y: number): Element | null {
    if (!glassPane) return null

    // Temporarily hide glass pane to click through
    const originalPointerEvents = glassPane.style.pointerEvents
    glassPane.style.pointerEvents = 'none'

    try {
      return document.elementFromPoint(x, y)
    } finally {
      glassPane.style.pointerEvents = originalPointerEvents
    }
  }

  function createSelectionOverlay(): HTMLDivElement {
    const overlay = document.createElement('div')
    overlay.className = 'annotator-ignore'
    overlay.style.cssText = `
      position: fixed;
      border: 2px dashed ${COLORS.INSPECTION};
      background: rgba(168, 85, 247, 0.1);
      pointer-events: none;
      z-index: ${Z_INDEX.HOVER_OVERLAY};
      border-radius: 4px;
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.3);
    `
    document.body.appendChild(overlay)
    return overlay
  }

  function updateSelectionOverlay(): void {
    if (!selectionOverlay) return

    const left = Math.min(dragState.startX, dragState.currentX)
    const top = Math.min(dragState.startY, dragState.currentY)
    const width = Math.abs(dragState.currentX - dragState.startX)
    const height = Math.abs(dragState.currentY - dragState.startY)

    selectionOverlay.style.left = `${left}px`
    selectionOverlay.style.top = `${top}px`
    selectionOverlay.style.width = `${width}px`
    selectionOverlay.style.height = `${height}px`
  }

  function removeSelectionOverlay(): void {
    if (selectionOverlay) {
      selectionOverlay.remove()
      selectionOverlay = null
    }
  }

  function getSelectionRect(): DOMRect {
    const left = Math.min(dragState.startX, dragState.currentX)
    const top = Math.min(dragState.startY, dragState.currentY)
    const width = Math.abs(dragState.currentX - dragState.startX)
    const height = Math.abs(dragState.currentY - dragState.startY)

    return new DOMRect(left, top, width, height)
  }

  function isFullyContained(inner: DOMRect, outer: DOMRect): boolean {
    return inner.left >= outer.left &&
           inner.right <= outer.right &&
           inner.top >= outer.top &&
           inner.bottom <= outer.bottom
  }

  function findElementsFullyInRect(rect: DOMRect): Element[] {
    // Hide glass pane to ensure accurate measurements if needed
    if (glassPane) glassPane.style.display = 'none'

    try {
      const elements: Element[] = []

      // Recursive traversal is more efficient than querySelectorAll('*') for filtering
      function traverse(node: Element) {
        if (shouldIgnoreElement?.(node)) return
        if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'NOSCRIPT') return

        const elementRect = node.getBoundingClientRect()

        // Optimization: Skip branch if element is completely outside rect AND not containing the rect
        // (For simplicity, we traverse all but could optimize spatial pruning here)

        if (elementRect.width > 0 && elementRect.height > 0) {
          if (isFullyContained(elementRect, rect)) {
            elements.push(node)
          }
        }

        const children = node.children
        for (let i = 0; i < children.length; i++) {
          traverse(children[i])
        }
      }

      traverse(document.body)
      return elements
    } finally {
      if (glassPane) glassPane.style.display = 'block'
    }
  }

  function filterLeafElements(elements: Element[]): Element[] {
    // Remove parents if their children are also selected (keep only leaves)
    return elements.filter(el => {
      return !elements.some(other => other !== el && el.contains(other))
    })
  }

  function handleMouseDown(e: MouseEvent): void {
    // Glass pane intercepts, so no need to check target usually,
    // but good to respect ignore rules if event bubbles from toolbar
    const clickedElement = e.target as Element
    if (shouldIgnoreElement?.(clickedElement) && clickedElement !== glassPane) return

    mouseDownTime = Date.now()
    dragState = {
      isDragging: false,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY
    }
  }

  function handleMouseMove(e: MouseEvent): void {
    // Check if we're in a potential drag state
    if (mouseDownTime > 0) {
      const dx = Math.abs(e.clientX - dragState.startX)
      const dy = Math.abs(e.clientY - dragState.startY)

      // Start dragging if moved past threshold
      if (!dragState.isDragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
        dragState.isDragging = true
        removeHoverHighlight()
        selectionOverlay = createSelectionOverlay()
      }

      if (dragState.isDragging) {
        dragState.currentX = e.clientX
        dragState.currentY = e.clientY
        updateSelectionOverlay()
        return
      }
    }

    // Normal hover behavior when not dragging
    const target = getElementAtPoint(e.clientX, e.clientY)
    if (!target || shouldIgnoreElement?.(target)) {
      removeHoverHighlight()
      return
    }

    // Skip if already selected
    if (isElementSelected?.(target)) {
      removeHoverHighlight()
      return
    }

    if (target === currentHoveredElement) {
      // Update position in case element moved
      updateHoverOverlay(target)
      return
    }

    removeHoverHighlight()

    // Use overlay instead of outline (z-index issue)
    hoverOverlay = createHoverOverlay(target)
    currentHoveredElement = target
  }

  /**
   * Detects if user made a text selection and extracts the range and ancestor.
   * Returns null if no valid text selection exists.
   */
  function detectTextSelection(): { range: Range; commonAncestor: Element } | null {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

    const selectedText = selection.toString().trim()
    if (selectedText.length === 0) return null

    const range = selection.getRangeAt(0)

    // Find common ancestor element (Range.commonAncestorContainer can be a text node)
    const ancestor = range.commonAncestorContainer
    const commonAncestor = ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor as Element
      : ancestor.parentElement

    if (!commonAncestor || shouldIgnoreElement?.(commonAncestor)) return null

    return { range, commonAncestor }
  }

  function handleMouseUp(e: MouseEvent): void {
    const wasDragging = dragState.isDragging

    try {
      if (wasDragging) {
        // Complete drag selection
        removeSelectionOverlay()

        const selectionRect = getSelectionRect()
        // Only process if selection has some size
        if (selectionRect.width > 10 && selectionRect.height > 10) {
          const elementsInRect = findElementsFullyInRect(selectionRect)
          const leafElements = filterLeafElements(elementsInRect)

          if (leafElements.length > 0) {
            onMultiSelect?.(leafElements)
          }
        }
      } else if (mouseDownTime > 0) {
        // Check for text selection first (user dragged to select text)
        const textSelection = detectTextSelection()

        if (textSelection) {
          // Clone range before clearing selection (Range becomes invalid after removeAllRanges)
          const range = textSelection.range.cloneRange()
          const commonAncestor = textSelection.commonAncestor

          // Clear browser selection BEFORE callback to avoid race conditions
          window.getSelection()?.removeAllRanges()

          onTextSelect?.(range, commonAncestor)
          return
        }

        // Was not dragging and no text selection → single click selection
        const target = getElementAtPoint(e.clientX, e.clientY)
        if (target && !shouldIgnoreElement?.(target)) {
          onElementSelect?.(target)
        }
      }
    } finally {
      // Always reset drag state, even if callback throws
      mouseDownTime = 0
      dragState = { ...INITIAL_DRAG_STATE }
    }
  }

  function preventClick(e: MouseEvent): void {
    // Glass pane intercepts all clicks
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }

  function preventMouseEvents(e: Event): void {
    // Glass pane intercepts all mouse events
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }

  // Industry standard: Only handle specific shortcuts, don't block all keyboard events
  function handleKeyDown(e: KeyboardEvent): void {
    // Escape to exit inspecting mode
    if (e.key === 'Escape') {
      e.preventDefault()
      onEscape?.()
      return
    }

    // Cmd/Ctrl+C to copy selected elements (only when no text is selected)
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        e.preventDefault()
        onCopy?.()
      }
    }
  }

  function resetDragState(): void {
    mouseDownTime = 0
    dragState = { ...INITIAL_DRAG_STATE }
    removeSelectionOverlay()
  }

  function cleanup(): void {
    removeGlassPane()
    document.removeEventListener('keydown', handleKeyDown)

    removeHoverHighlight()
    resetDragState()

    // Clear any browser text selection when exiting inspection mode
    window.getSelection()?.removeAllRanges()
  }

  function cleanupKeyframesStyle(): void {
    if (hoverKeyframesStyleElement) {
      hoverKeyframesStyleElement.remove()
      hoverKeyframesStyleElement = null
    }
  }

  return {
    enterInspectionMode(): void {
      if (isInspecting) return

      isInspecting = true
      glassPane = createGlassPane()

      // Keyboard: attach to document as it bubbles up
      document.addEventListener('keydown', handleKeyDown)
    },

    exitInspectionMode(): void {
      if (!isInspecting) return
      isInspecting = false
      cleanup()
      cleanupKeyframesStyle()
    },

    isInInspectionMode(): boolean {
      return isInspecting
    },

    destroy(): void {
      if (isInspecting) {
        isInspecting = false
        cleanup()
      }
      cleanupKeyframesStyle()
    }
  }
}
