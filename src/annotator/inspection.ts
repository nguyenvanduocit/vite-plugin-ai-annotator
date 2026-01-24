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
    // Disable pointer-events and text selection on all elements
    // Then use elementFromPoint to track what's under the cursor
    // Exclude: annotator-toolbar, annotator-badge (selection badges), annotator-ignore
    inspectionStyleElement.textContent = `
      * {
        pointer-events: none !important;
        cursor: crosshair !important;
        user-select: none !important;
        -webkit-user-select: none !important;
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

  function findLowestCommonAncestor(elements: Element[]): Element | null {
    if (elements.length === 0) return null
    if (elements.length === 1) return elements[0]

    // Get all ancestors for the first element
    const getAncestors = (el: Element): Element[] => {
      const ancestors: Element[] = []
      let current: Element | null = el
      while (current && current !== document.body && current !== document.documentElement) {
        ancestors.push(current)
        current = current.parentElement
      }
      if (document.body) ancestors.push(document.body)
      return ancestors
    }

    const firstAncestors = getAncestors(elements[0])

    // Find the first common ancestor
    for (const ancestor of firstAncestors) {
      const isCommon = elements.every(el => ancestor.contains(el))
      if (isCommon) {
        return ancestor
      }
    }

    return document.body
  }

  function findDirectChildrenInRect(parent: Element, rect: DOMRect, allElements: Element[]): Element[] {
    // Find direct children of parent that either:
    // 1. Intersect with the selection rect
    // 2. Contain elements that intersect with the selection rect
    const result: Element[] = []
    const childrenSet = new Set<Element>()

    for (const element of allElements) {
      // Walk up from element to find which direct child of parent contains it
      let current: Element | null = element
      while (current && current.parentElement !== parent) {
        current = current.parentElement
      }

      if (current && current.parentElement === parent) {
        childrenSet.add(current)
      }
    }

    // Filter: only keep children that actually intersect with rect
    for (const child of childrenSet) {
      const childRect = child.getBoundingClientRect()
      if (rectsIntersect(rect, childRect)) {
        result.push(child)
      }
    }

    return result
  }

  function findLeafElements(elements: Element[]): Element[] {
    // Find elements that don't have any other selected element as descendant
    return elements.filter(el => {
      return !elements.some(other => other !== el && el.contains(other))
    })
  }

  function isSemanticContainer(el: Element): boolean {
    // Check if element is a meaningful container worth selecting
    const tag = el.tagName.toLowerCase()
    const semanticTags = ['article', 'section', 'aside', 'nav', 'header', 'footer', 'main', 'div', 'li', 'tr', 'td', 'th', 'form', 'fieldset']
    if (!semanticTags.includes(tag)) return false

    // Check for common component class patterns
    const className = el.className || ''
    const hasComponentClass = /card|item|row|cell|box|panel|widget|block|container|wrapper|group|list|grid/i.test(className)

    // Check for data attributes that suggest a component
    const hasDataAttr = el.hasAttribute('data-testid') || el.hasAttribute('data-component') || el.hasAttribute('data-v-')

    return hasComponentClass || hasDataAttr || tag !== 'div'
  }

  function selectSmartElements(elements: Element[], selectionRect: DOMRect): Element[] {
    if (elements.length === 0) return []
    if (elements.length === 1) return elements

    // Get leaf elements only (most specific)
    const leafElements = findLeafElements(elements)
    if (leafElements.length === 0) return elements.slice(0, 1)
    if (leafElements.length === 1) return leafElements

    // Find LCA of leaf elements
    const lca = findLowestCommonAncestor(leafElements)
    if (!lca || lca === document.body || lca === document.documentElement) {
      return filterByDOMDepth(leafElements)
    }

    // Check if all leaf elements are direct children of LCA
    const allDirectChildren = leafElements.every(el => el.parentElement === lca)

    if (allDirectChildren) {
      // All elements are siblings → select their parent (the container)
      // Example: 3 buttons directly in card → select card
      return [lca]
    }

    // Elements are nested in sub-containers
    // Find the direct children of LCA that contain our elements
    const directChildren = findDirectChildrenInRect(lca, selectionRect, leafElements)

    if (directChildren.length === 1) {
      // Only one branch contains all elements → recurse into it
      const child = directChildren[0]
      const childLeafElements = leafElements.filter(el => child.contains(el))

      if (childLeafElements.length > 1) {
        // Check if all are direct children of this child
        const allDirectOfChild = childLeafElements.every(el => el.parentElement === child)
        if (allDirectOfChild) {
          // Example: 3 buttons in footer → select footer
          return [child]
        }
        // Recurse deeper
        return selectSmartElements(childLeafElements, selectionRect)
      }
      return [child]
    }

    // Multiple branches selected
    // Check if LCA is a semantic container worth selecting
    if (isSemanticContainer(lca)) {
      return [lca]
    }

    // Otherwise return the direct children (sub-containers)
    return directChildren.length > 0 ? directChildren : [lca]
  }

  function filterByDOMDepth(elements: Element[]): Element[] {
    // Group elements by their DOM depth and return the most common depth level
    const getDepth = (el: Element): number => {
      let depth = 0
      let current: Element | null = el
      while (current && current !== document.body) {
        depth++
        current = current.parentElement
      }
      return depth
    }

    const depthMap = new Map<number, Element[]>()
    for (const el of elements) {
      const depth = getDepth(el)
      if (!depthMap.has(depth)) {
        depthMap.set(depth, [])
      }
      depthMap.get(depth)!.push(el)
    }

    // Find depth with most elements
    let maxCount = 0
    let bestDepth = 0
    for (const [depth, els] of depthMap) {
      if (els.length > maxCount) {
        maxCount = els.length
        bestDepth = depth
      }
    }

    return depthMap.get(bestDepth) || elements
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
        const smartElements = selectSmartElements(elementsInRect, selectionRect)

        if (smartElements.length > 0) {
          onMultiSelect?.(smartElements)
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