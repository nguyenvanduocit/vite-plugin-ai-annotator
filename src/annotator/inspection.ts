/**
 * Inspection Manager for mouse inspection mode handling
 * Supports both single-click selection and drag-to-select multiple elements
 * Also supports text selection for annotating specific text content
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
  let inspectionStyleElement: HTMLStyleElement | null = null
  let selectionOverlay: HTMLDivElement | null = null
  let dragState: DragState = { ...INITIAL_DRAG_STATE }
  let mouseDownTime = 0

  function addInspectionStyles(): void {
    inspectionStyleElement = document.createElement('style')
    inspectionStyleElement.id = 'annotator-inspection-styles'
    // Only change cursor, allow native text selection
    inspectionStyleElement.textContent = `
      body.annotator-inspecting * {
        cursor: crosshair !important;
      }
      body.annotator-inspecting *::selection {
        background: ${COLORS.INSPECTION}40 !important;
      }
      annotator-toolbar, annotator-toolbar *,
      .annotator-badge, .annotator-badge *,
      .annotator-ignore, .annotator-ignore * {
        cursor: default !important;
      }
    `
    document.head.appendChild(inspectionStyleElement)
    document.body.classList.add('annotator-inspecting')
  }

  function removeInspectionStyles(): void {
    if (inspectionStyleElement) {
      inspectionStyleElement.remove()
      inspectionStyleElement = null
    }
    document.body.classList.remove('annotator-inspecting')
  }

  function removeHoverHighlight(): void {
    if (hoverOverlay) {
      hoverOverlay.remove()
      hoverOverlay = null
    }
    currentHoveredElement = null
  }

  function createHoverOverlay(element: Element): HTMLDivElement {
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
    overlay.className = 'annotator-hover-overlay annotator-ignore'
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
    const elements: Element[] = []

    function traverse(node: Element) {
      if (shouldIgnoreElement?.(node)) return
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'NOSCRIPT') return

      const elementRect = node.getBoundingClientRect()

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
  }

  function filterLeafElements(elements: Element[]): Element[] {
    return elements.filter(el => {
      return !elements.some(other => other !== el && el.contains(other))
    })
  }

  function handleMouseDown(e: MouseEvent): void {
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
    // Don't preventDefault - allow native text selection to work
  }

  function handleMouseMove(e: MouseEvent): void {
    // Check if we're in a potential drag state for rectangle selection
    // Only show rectangle overlay if there's no text being selected
    if (mouseDownTime > 0 && !dragState.isDragging) {
      const dx = Math.abs(e.clientX - dragState.startX)
      const dy = Math.abs(e.clientY - dragState.startY)

      // Start rectangle drag if moved past threshold AND no text selection in progress
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        const selection = window.getSelection()
        const hasTextSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0

        // If user is selecting text, don't start rectangle selection
        if (!hasTextSelection) {
          dragState.isDragging = true
          removeHoverHighlight()
          selectionOverlay = createSelectionOverlay()
        }
      }
    }

    if (dragState.isDragging) {
      dragState.currentX = e.clientX
      dragState.currentY = e.clientY
      updateSelectionOverlay()
      return
    }

    // Normal hover behavior when not dragging
    const target = document.elementFromPoint(e.clientX, e.clientY)
    if (!target || shouldIgnoreElement?.(target)) {
      removeHoverHighlight()
      return
    }

    if (isElementSelected?.(target)) {
      removeHoverHighlight()
      return
    }

    if (target === currentHoveredElement) {
      updateHoverOverlay(target)
      return
    }

    removeHoverHighlight()
    hoverOverlay = createHoverOverlay(target)
    currentHoveredElement = target
  }

  /**
   * Detects if user made a text selection and extracts the range and ancestor.
   */
  function detectTextSelection(): { range: Range; commonAncestor: Element } | null {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

    const selectedText = selection.toString().trim()
    if (selectedText.length === 0) return null

    const range = selection.getRangeAt(0)

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
      // Priority 1: Check for text selection (user dragged to select text)
      const textSelection = detectTextSelection()
      if (textSelection) {
        const range = textSelection.range.cloneRange()
        const commonAncestor = textSelection.commonAncestor

        window.getSelection()?.removeAllRanges()
        onTextSelect?.(range, commonAncestor)
        return
      }

      // Priority 2: Rectangle drag selection
      if (wasDragging) {
        removeSelectionOverlay()

        const selectionRect = getSelectionRect()
        if (selectionRect.width > 10 && selectionRect.height > 10) {
          const elementsInRect = findElementsFullyInRect(selectionRect)
          const leafElements = filterLeafElements(elementsInRect)

          if (leafElements.length > 0) {
            onMultiSelect?.(leafElements)
          }
        }
        return
      }

      // Priority 3: Single click = element selection
      if (mouseDownTime > 0) {
        const target = document.elementFromPoint(e.clientX, e.clientY)
        if (target && !shouldIgnoreElement?.(target)) {
          onElementSelect?.(target)
        }
      }
    } finally {
      mouseDownTime = 0
      dragState = { ...INITIAL_DRAG_STATE }
    }
  }

  function handleClick(e: MouseEvent): void {
    const target = e.target as Element
    if (shouldIgnoreElement?.(target)) return

    // Prevent default click behavior (navigation, form submit, etc)
    e.preventDefault()
  }

  function preventMouseEvents(e: Event): void {
    const target = e.target as Element
    if (shouldIgnoreElement?.(target)) return

    e.preventDefault()
    e.stopPropagation()
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      onEscape?.()
      return
    }

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
      addInspectionStyles()

      document.addEventListener('mousedown', handleMouseDown, true)
      document.addEventListener('mousemove', handleMouseMove, true)
      document.addEventListener('mouseup', handleMouseUp, true)
      document.addEventListener('click', handleClick, true)
      document.addEventListener('dblclick', preventMouseEvents, true)
      document.addEventListener('contextmenu', preventMouseEvents, true)
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
