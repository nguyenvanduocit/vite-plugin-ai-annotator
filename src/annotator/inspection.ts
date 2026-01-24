/**
 * Inspection Manager for mouse inspection mode handling
 * Supports both single-click selection and drag-to-select multiple elements
 */

export interface InspectionManager {
  enterInspectionMode(): void
  exitInspectionMode(): void
  isInInspectionMode(): boolean
  destroy(): void
}

export interface InspectionCallbacks {
  onElementSelect?: (element: Element) => void
  onMultiSelect?: (elements: Element[]) => void
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

export function createInspectionManager(callbacks: InspectionCallbacks = {}): InspectionManager {
  const { onElementSelect, onMultiSelect, shouldIgnoreElement, isElementSelected, onEscape, onCopy } = callbacks
  let isInspecting = false
  let currentHoveredElement: Element | null = null
  let inspectionStyleElement: HTMLStyleElement | null = null
  let selectionOverlay: HTMLDivElement | null = null
  let dragState: DragState = { isDragging: false, startX: 0, startY: 0, currentX: 0, currentY: 0 }
  let mouseDownTime = 0

  function addInspectionStyles(): void {
    inspectionStyleElement = document.createElement('style')
    inspectionStyleElement.id = 'annotator-toolbar-styles'
    // Disable pointer-events on all elements to prevent hover/click effects
    // Then use elementFromPoint to track what's under the cursor
    // Exclude: annotator-toolbar, annotator-badge (selection badges), annotator-ignore
    inspectionStyleElement.textContent = `
      * {
        pointer-events: none !important;
        cursor: crosshair !important;
      }
      annotator-toolbar, annotator-toolbar *,
      .annotator-badge, .annotator-badge *,
      .annotator-ignore {
        pointer-events: auto !important;
        cursor: default !important;
      }
    `
    document.head.appendChild(inspectionStyleElement)
  }

  function removeInspectionStyles(): void {
    if (inspectionStyleElement) {
      inspectionStyleElement.remove()
      inspectionStyleElement = null
    }
  }

  function removeHoverHighlight(): void {
    if (currentHoveredElement) {
      if (!isElementSelected?.(currentHoveredElement)) {
        ;(currentHoveredElement as HTMLElement).style.outline = ''
        ;(currentHoveredElement as HTMLElement).style.outlineOffset = ''
      }
      currentHoveredElement = null
    }
  }

  function getElementAtPoint(x: number, y: number): Element | null {
    // Temporarily enable pointer-events to use elementFromPoint
    if (inspectionStyleElement) {
      inspectionStyleElement.disabled = true
    }
    const element = document.elementFromPoint(x, y)
    if (inspectionStyleElement) {
      inspectionStyleElement.disabled = false
    }
    return element
  }

  function createSelectionOverlay(): HTMLDivElement {
    const overlay = document.createElement('div')
    overlay.className = 'annotator-ignore'
    overlay.style.cssText = `
      position: fixed;
      border: 2px dashed #00FFFF;
      background: rgba(0, 255, 255, 0.1);
      pointer-events: none;
      z-index: 999999;
      box-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
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

  function rectsIntersect(r1: DOMRect, r2: DOMRect): boolean {
    return !(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom)
  }

  function findElementsInRect(rect: DOMRect): Element[] {
    // Temporarily enable pointer-events
    if (inspectionStyleElement) {
      inspectionStyleElement.disabled = true
    }

    const elements: Element[] = []
    const allElements = document.body.querySelectorAll('*')

    for (const element of allElements) {
      if (shouldIgnoreElement?.(element)) continue
      if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE' || element.tagName === 'NOSCRIPT') continue

      const elementRect = element.getBoundingClientRect()
      // Skip elements with no visible area
      if (elementRect.width === 0 || elementRect.height === 0) continue

      if (rectsIntersect(rect, elementRect)) {
        elements.push(element)
      }
    }

    if (inspectionStyleElement) {
      inspectionStyleElement.disabled = false
    }

    return elements
  }

  function filterBestElements(elements: Element[]): Element[] {
    // Remove parents if their children are also selected
    // Keep only the most specific (leaf) elements
    const result: Element[] = []

    for (const element of elements) {
      // Check if any of this element's descendants are also in the selection
      let hasSelectedDescendant = false
      for (const other of elements) {
        if (other !== element && element.contains(other)) {
          hasSelectedDescendant = true
          break
        }
      }

      // Only keep elements that don't have selected descendants
      if (!hasSelectedDescendant) {
        result.push(element)
      }
    }

    return result
  }

  function handleMouseDown(e: MouseEvent): void {
    // Check if clicking on toolbar/badge elements
    const clickedElement = e.target as Element
    if (shouldIgnoreElement?.(clickedElement)) return

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

    if (target === currentHoveredElement) return

    removeHoverHighlight()

    ;(target as HTMLElement).style.outline = '2px solid #00FFFF'
    ;(target as HTMLElement).style.outlineOffset = '2px'
    currentHoveredElement = target
  }

  function handleMouseUp(_e: MouseEvent): void {
    const wasDragging = dragState.isDragging

    if (wasDragging) {
      // Complete drag selection
      removeSelectionOverlay()

      const selectionRect = getSelectionRect()
      // Only process if selection has some size
      if (selectionRect.width > 10 && selectionRect.height > 10) {
        const elementsInRect = findElementsInRect(selectionRect)
        const bestElements = filterBestElements(elementsInRect)

        if (bestElements.length > 0) {
          onMultiSelect?.(bestElements)
        }
      }
    }

    // Reset drag state
    mouseDownTime = 0
    dragState = { isDragging: false, startX: 0, startY: 0, currentX: 0, currentY: 0 }
  }

  function handleClick(e: MouseEvent): void {
    // If we were dragging, don't process as click
    if (dragState.isDragging) {
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // Check if clicking on toolbar/badge elements - let those through
    const clickedElement = e.target as Element
    if (shouldIgnoreElement?.(clickedElement)) return

    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    const target = getElementAtPoint(e.clientX, e.clientY)
    if (!target || shouldIgnoreElement?.(target)) return

    onElementSelect?.(target)
  }

  function preventMouseEvents(e: Event): void {
    // Let toolbar/badge events through
    const target = e.target as Element
    if (shouldIgnoreElement?.(target)) return

    // Don't prevent if we're dragging (we need mouse events for drag)
    if (dragState.isDragging) return

    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }

  // Industry standard: Only handle specific shortcuts, don't block all keyboard events
  // This allows page shortcuts to work and inputs to function normally
  // Reference: LocatorJS, click-to-component, vite-plugin-vue-inspector
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
      // If text is selected, let browser handle native copy
    }
  }

  function resetDragState(): void {
    mouseDownTime = 0
    dragState = { isDragging: false, startX: 0, startY: 0, currentX: 0, currentY: 0 }
    removeSelectionOverlay()
  }

  return {
    enterInspectionMode(): void {
      if (isInspecting) return

      isInspecting = true
      addInspectionStyles()

      // Use mousemove + elementFromPoint since pointer-events are disabled
      document.addEventListener('mousedown', handleMouseDown, true)
      document.addEventListener('mousemove', handleMouseMove, true)
      document.addEventListener('mouseup', handleMouseUp, true)
      document.addEventListener('click', handleClick, true)
      document.addEventListener('dblclick', preventMouseEvents, true)
      document.addEventListener('contextmenu', preventMouseEvents, true)
      // Keyboard: no capture needed - we only handle specific shortcuts, not blocking
      document.addEventListener('keydown', handleKeyDown)
    },

    exitInspectionMode(): void {
      if (!isInspecting) return

      isInspecting = false
      removeInspectionStyles()

      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('dblclick', preventMouseEvents, true)
      document.removeEventListener('contextmenu', preventMouseEvents, true)
      document.removeEventListener('keydown', handleKeyDown)

      removeHoverHighlight()
      resetDragState()
    },

    isInInspectionMode(): boolean {
      return isInspecting
    },

    destroy(): void {
      if (isInspecting) {
        isInspecting = false
        removeInspectionStyles()

        document.removeEventListener('mousedown', handleMouseDown, true)
        document.removeEventListener('mousemove', handleMouseMove, true)
        document.removeEventListener('mouseup', handleMouseUp, true)
        document.removeEventListener('click', handleClick, true)
        document.removeEventListener('dblclick', preventMouseEvents, true)
        document.removeEventListener('contextmenu', preventMouseEvents, true)
        document.removeEventListener('keydown', handleKeyDown)

        removeHoverHighlight()
        resetDragState()
      }
    }
  }
}