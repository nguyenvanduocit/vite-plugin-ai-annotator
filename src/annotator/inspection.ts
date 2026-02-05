/**
 * Inspection Manager for mouse inspection mode handling
 * Supports single-click element selection and text selection for annotating
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
  onTextSelect?: (range: Range, commonAncestor: Element) => void
  shouldIgnoreElement?: (element: Element) => boolean
  isElementSelected?: (element: Element) => boolean
  onEscape?: () => void
  onCopy?: () => void
}

export function createInspectionManager(callbacks: InspectionCallbacks = {}): InspectionManager {
  const { onElementSelect, onTextSelect, shouldIgnoreElement, isElementSelected, onEscape, onCopy } = callbacks
  let isInspecting = false
  let currentHoveredElement: Element | null = null
  let hoverOverlay: HTMLDivElement | null = null
  let hoverKeyframesStyleElement: HTMLStyleElement | null = null
  let inspectionStyleElement: HTMLStyleElement | null = null
  let mouseDownTime = 0

  function addInspectionStyles(): void {
    inspectionStyleElement = document.createElement('style')
    inspectionStyleElement.id = 'annotator-inspection-styles'
    // Only change cursor, keep native text selection styling
    inspectionStyleElement.textContent = `
      body.annotator-inspecting * {
        cursor: crosshair !important;
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

  function handleMouseDown(e: MouseEvent): void {
    const clickedElement = e.target as Element
    if (shouldIgnoreElement?.(clickedElement)) return

    mouseDownTime = Date.now()
    // Don't preventDefault - allow native text selection to work
  }

  function handleMouseMove(e: MouseEvent): void {
    // When mouse is down, user might be selecting text - hide hover highlight
    if (mouseDownTime > 0) {
      removeHoverHighlight()
      return
    }

    // Normal hover behavior when mouse is up
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

  function handleMouseUp(e: MouseEvent): void {
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

      // Priority 2: Single click = element selection
      if (mouseDownTime > 0) {
        const target = document.elementFromPoint(e.clientX, e.clientY)
        if (target && !shouldIgnoreElement?.(target)) {
          onElementSelect?.(target)
        }
      }
    } finally {
      mouseDownTime = 0
    }
  }

  function handleClick(e: MouseEvent): void {
    const target = e.target as Element
    if (shouldIgnoreElement?.(target)) return

    // Prevent default click behavior (navigation, form submit, etc)
    // and stop propagation to prevent any click handlers on elements
    e.preventDefault()
    e.stopPropagation()
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
    mouseDownTime = 0
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
