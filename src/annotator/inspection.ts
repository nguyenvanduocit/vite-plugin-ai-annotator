/**
 * Inspection Manager for mouse inspection mode handling
 */

export interface InspectionManager {
  enterInspectionMode(): void
  exitInspectionMode(): void
  isInInspectionMode(): boolean
  destroy(): void
}

export interface InspectionCallbacks {
  onElementSelect?: (element: Element) => void
  shouldIgnoreElement?: (element: Element) => boolean
  isElementSelected?: (element: Element) => boolean
  onEscape?: () => void
  onCopy?: () => void
}

export function createInspectionManager(callbacks: InspectionCallbacks = {}): InspectionManager {
  const { onElementSelect, shouldIgnoreElement, isElementSelected, onEscape, onCopy } = callbacks
  let isInspecting = false
  let currentHoveredElement: Element | null = null
  let inspectionStyleElement: HTMLStyleElement | null = null

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

  function handleMouseMove(e: MouseEvent): void {
    const target = getElementAtPoint(e.clientX, e.clientY)
    if (!target || shouldIgnoreElement?.(target)) {
      removeHoverHighlight()
      return
    }

    if (target === currentHoveredElement) return

    removeHoverHighlight()

    ;(target as HTMLElement).style.outline = '3px solid #3B82F6'
    ;(target as HTMLElement).style.outlineOffset = '-1px'
    currentHoveredElement = target
  }

  function handleClick(e: MouseEvent): void {
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

  return {
    enterInspectionMode(): void {
      if (isInspecting) return

      isInspecting = true
      addInspectionStyles()

      // Use mousemove + elementFromPoint since pointer-events are disabled
      document.addEventListener('mousemove', handleMouseMove, true)
      document.addEventListener('click', handleClick, true)
      document.addEventListener('mousedown', preventMouseEvents, true)
      document.addEventListener('mouseup', preventMouseEvents, true)
      document.addEventListener('dblclick', preventMouseEvents, true)
      document.addEventListener('contextmenu', preventMouseEvents, true)
      // Keyboard: no capture needed - we only handle specific shortcuts, not blocking
      document.addEventListener('keydown', handleKeyDown)
    },

    exitInspectionMode(): void {
      if (!isInspecting) return

      isInspecting = false
      removeInspectionStyles()

      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('mousedown', preventMouseEvents, true)
      document.removeEventListener('mouseup', preventMouseEvents, true)
      document.removeEventListener('dblclick', preventMouseEvents, true)
      document.removeEventListener('contextmenu', preventMouseEvents, true)
      document.removeEventListener('keydown', handleKeyDown)

      removeHoverHighlight()
    },

    isInInspectionMode(): boolean {
      return isInspecting
    },

    destroy(): void {
      if (isInspecting) {
        isInspecting = false
        removeInspectionStyles()

        document.removeEventListener('mousemove', handleMouseMove, true)
        document.removeEventListener('click', handleClick, true)
        document.removeEventListener('mousedown', preventMouseEvents, true)
        document.removeEventListener('mouseup', preventMouseEvents, true)
        document.removeEventListener('dblclick', preventMouseEvents, true)
        document.removeEventListener('contextmenu', preventMouseEvents, true)
        document.removeEventListener('keydown', handleKeyDown)

        removeHoverHighlight()
      }
    }
  }
}