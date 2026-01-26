/**
 * Element Selection Manager for element selection, highlighting, and badge management
 */

import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom'
import type { ElementData } from '../rpc/define'
import type { ComponentInfo } from './detectors'
import { XPathUtils } from '../utils/xpath'

export interface SelectedElementInfo {
  color: string
  index: number
  displayText: string // Store for reindexing
}

// Z-index hierarchy constants
const Z_INDEX = {
  HIGHLIGHT_OVERLAY: 999996,
  HOVER_OVERLAY: 999997,
  BADGE: 999998,
  TOOLBAR: 999999,
} as const

// Selection group - all UI elements for one selected element share ONE position tracker
interface SelectionGroup {
  badge: HTMLElement
  overlay: HTMLElement
  cleanup: () => void
}

// Component finder function type
type ComponentFinder = (el: Element) => ComponentInfo | null

export interface ElementSelectionManager {
  selectElement(element: Element, componentFinder?: ComponentFinder): void
  deselectElement(element: Element): void
  clearAllSelections(): void
  hasElement(element: Element): boolean
  getSelectedElements(): Map<Element, SelectedElementInfo>
  getSelectedCount(): number
  findSelectedParent(element: Element): Element | null
  findSelectedChildren(element: Element): Element[]
  buildHierarchicalStructure(componentFinder?: ComponentFinder, imagePaths?: Map<Element, string>): ElementData[]
  setOnEditClick(callback: (element: Element) => void): void
}

export function createElementSelectionManager(): ElementSelectionManager {
  const selectedElements = new Map<Element, SelectedElementInfo>()
  const selectionGroups = new Map<Element, SelectionGroup>()
  let colorIndex = 0
  let onEditClickCallback: ((element: Element) => void) | null = null
  let keyframesStyleElement: HTMLStyleElement | null = null

  // Cyberpunk color palette (uses modulo for cycling)
  const colors = ['#FF00FF', '#00FFFF', '#FFFF00'] // cyber-pink, cyber-cyan, cyber-yellow

  function getDisplayText(index: number, element: Element, componentFinder?: ComponentFinder): string {
    const component = componentFinder?.(element)
    if (component && component.componentLocation) {
      const componentPath = component.componentLocation.split('@')[0]
      const fileName = componentPath.split('/').pop()
      return `#${index} ${fileName}`
    }
    return `#${index} ${element.tagName}`
  }

  function ensureKeyframesStyle(): void {
    if (!keyframesStyleElement) {
      keyframesStyleElement = document.createElement('style')
      keyframesStyleElement.id = 'annotator-keyframes'
      keyframesStyleElement.textContent = `
        @keyframes marching-ants {
          0% { background-position: 0 0, 100% 100%, 0 100%, 100% 0; }
          100% { background-position: 20px 0, calc(100% - 20px) 100%, 0 calc(100% - 20px), 100% 20px; }
        }
      `
      document.head.appendChild(keyframesStyleElement)
    }
  }

  // Create all UI elements for a selected element with ONE shared position tracker
  function createSelectionGroup(element: Element, color: string, displayText: string): SelectionGroup {
    const textColor = '#050505'
    const glowColor = color.toLowerCase()

    // --- Create Badge ---
    const badge = document.createElement('div')
    badge.classList.add('annotator-badge')

    const shadow = badge.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');

      @keyframes badge-glow {
        0%, 100% { box-shadow: 2px 2px 0px ${color}44, 0 0 8px ${glowColor}80; }
        50% { box-shadow: 2px 2px 0px ${color}66, 0 0 15px ${glowColor}aa; }
      }

      .badge-container {
        display: flex;
        align-items: center;
        border: 1px solid ${color};
        background: #050505;
        box-shadow: 1px 1px 0px ${color}44, 0 0 6px ${glowColor}60;
        animation: badge-glow 2s ease-in-out infinite;
        cursor: pointer;
        transition: all 0.1s ease;
      }
      .badge-container:hover {
        box-shadow: 2px 2px 0px ${color}66, 0 0 12px ${glowColor}aa;
      }
      .badge {
        height: 14px;
        padding: 0 4px;
        background-color: ${color};
        color: ${textColor};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 700;
        font-family: 'JetBrains Mono', monospace;
        white-space: nowrap;
        text-transform: uppercase;
      }
    `

    const container = document.createElement('div')
    container.classList.add('badge-container', 'annotator-ignore')

    const badgeContent = document.createElement('div')
    badgeContent.classList.add('badge', 'annotator-ignore')
    badgeContent.textContent = displayText

    // Badge click handler (for clicking directly on badge)
    container.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      if (onEditClickCallback) {
        onEditClickCallback(element)
      }
    })

    container.appendChild(badgeContent)
    shadow.appendChild(style)
    shadow.appendChild(container)

    badge.style.cssText = `position: fixed; top: 0; left: 0; z-index: ${Z_INDEX.BADGE};`
    document.body.appendChild(badge)

    // --- Create Highlight Overlay ---
    ensureKeyframesStyle()

    const overlay = document.createElement('div')
    overlay.className = 'annotator-highlight-overlay annotator-ignore'
    overlay.style.cssText = `
      position: fixed;
      cursor: pointer;
      box-sizing: border-box;
      z-index: ${Z_INDEX.HIGHLIGHT_OVERLAY};
      background:
        linear-gradient(90deg, ${color} 50%, transparent 50%) repeat-x top left / 10px 2px,
        linear-gradient(90deg, ${color} 50%, transparent 50%) repeat-x bottom left / 10px 2px,
        linear-gradient(0deg, ${color} 50%, transparent 50%) repeat-y top left / 2px 10px,
        linear-gradient(0deg, ${color} 50%, transparent 50%) repeat-y top right / 2px 10px;
      animation: marching-ants 0.4s linear infinite;
    `

    // Overlay handles click on selected element area
    overlay.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      if (onEditClickCallback) {
        onEditClickCallback(element)
      }
    })

    document.body.appendChild(overlay)

    // --- ONE autoUpdate for BOTH badge and overlay ---
    let cleanup: (() => void) | null = null
    cleanup = autoUpdate(element, badge, () => {
      // Handle element removal during framework re-renders
      if (!element.isConnected) {
        cleanup?.()
        badge.remove()
        overlay.remove()
        return
      }

      // Update overlay position (simple rect)
      const rect = element.getBoundingClientRect()
      overlay.style.left = `${rect.left}px`
      overlay.style.top = `${rect.top}px`
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`

      // Update badge position (floating-ui with smart placement)
      computePosition(element, badge, {
        strategy: 'fixed',
        placement: 'top-start',
        middleware: [
          offset({ mainAxis: -5, crossAxis: 7 }),
          flip({ fallbackPlacements: ['bottom-start', 'top-end', 'bottom-end'] }),
          shift({ padding: 5 }),
        ],
      }).then(({ x, y }) => {
        badge.style.left = `${x}px`
        badge.style.top = `${y}px`
      })
    })

    return { badge, overlay, cleanup: cleanup! }
  }

  function reindexElements(): void {
    let index = 1

    selectedElements.forEach((data, element) => {
      // Update index but preserve the base display text (without the index prefix)
      const baseText = data.displayText.replace(/^#\d+\s*/, '')
      data.index = index
      data.displayText = `#${index} ${baseText}`

      const group = selectionGroups.get(element)
      if (group) {
        const badgeContent = group.badge.shadowRoot?.querySelector('.badge')
        if (badgeContent) {
          badgeContent.textContent = data.displayText
        }
      }

      index++
    })
  }

  function findSelectedParent(element: Element): Element | null {
    let currentElement = element.parentElement

    while (currentElement && currentElement !== document.body) {
      if (selectedElements.has(currentElement)) {
        return currentElement
      }
      currentElement = currentElement.parentElement
    }

    return null
  }

  function findSelectedChildren(element: Element): Element[] {
    const children: Element[] = []

    selectedElements.forEach((_, selectedElement) => {
      if (element.contains(selectedElement) && selectedElement !== element) {
        children.push(selectedElement)
      }
    })

    return children
  }

  return {
    selectElement(element: Element, componentFinder?: ComponentFinder): void {
      const color = colors[colorIndex % colors.length]
      const index = selectedElements.size + 1
      colorIndex++

      // Get display text for badge (preserves component info for reindexing)
      const displayText = getDisplayText(index, element, componentFinder)

      // Create selection group with ONE autoUpdate for both badge and overlay
      const group = createSelectionGroup(element, color, displayText)
      selectionGroups.set(element, group)

      selectedElements.set(element, { color, index, displayText })
    },

    deselectElement(element: Element): void {
      const elementData = selectedElements.get(element)
      if (elementData) {
        const group = selectionGroups.get(element)
        if (group) {
          group.cleanup()
          group.badge.remove()
          group.overlay.remove()
          selectionGroups.delete(element)
        }

        selectedElements.delete(element)
        reindexElements()
      }
    },

    clearAllSelections(): void {
      // Remove all selection groups
      selectionGroups.forEach(group => {
        group.cleanup()
        group.badge.remove()
        group.overlay.remove()
      })
      selectionGroups.clear()

      selectedElements.clear()
      colorIndex = 0

      // Clean up keyframes style element
      if (keyframesStyleElement) {
        keyframesStyleElement.remove()
        keyframesStyleElement = null
      }
    },

    hasElement(element: Element): boolean {
      return selectedElements.has(element)
    },

    getSelectedElements(): Map<Element, SelectedElementInfo> {
      return selectedElements
    },

    getSelectedCount(): number {
      return selectedElements.size
    },

    findSelectedParent,

    findSelectedChildren,

    setOnEditClick(callback: (element: Element) => void): void {
      onEditClickCallback = callback
    },

    buildHierarchicalStructure(componentFinder?: ComponentFinder, imagePaths?: Map<Element, string>): ElementData[] {
      const rootElements: Element[] = []

      selectedElements.forEach((_, element) => {
        if (!findSelectedParent(element)) {
          rootElements.push(element)
        }
      })

      const buildElementInfo = (element: Element): ElementData => {
        const data = selectedElements.get(element)!
        const children = findSelectedChildren(element)

        const componentData = componentFinder?.(element)

        const elementInfo: ElementData = {
          index: data.index,
          tagName: element.tagName,
          xpath: XPathUtils.generateXPath(element),
          cssSelector: XPathUtils.generateEnhancedCSSSelector(element),
          textContent: element.textContent?.substring(0, 100) || '',
          attributes: Array.from(element.attributes).reduce((acc, attr) => {
            if (attr.name !== 'style') {
              acc[attr.name] = attr.value
            }
            return acc
          }, {} as Record<string, string>),
          children: [],
        }

        // Add image path if available
        if (imagePaths && imagePaths.has(element)) {
          elementInfo.imagePath = imagePaths.get(element)
        }

        // Add computed styles
        try {
          const htmlElement = element as HTMLElement
          const computedStyle = window.getComputedStyle(htmlElement)
          elementInfo.computedStyles = {
            width: htmlElement.offsetWidth,
            height: htmlElement.offsetHeight,
            fontSize: computedStyle.fontSize,
            fontFamily: computedStyle.fontFamily,
            color: computedStyle.color || undefined,
            backgroundColor: computedStyle.backgroundColor || undefined,
            display: computedStyle.display || undefined,
            position: computedStyle.position || undefined,
          }
        } catch (error) {
          // Skip computed styles if there's an error getting them
          console.warn('Failed to get computed styles for element:', error)
        }

        if (componentData) {
          elementInfo.componentData = componentData
        }

        const directChildren = children.filter(child =>
          findSelectedParent(child) === element,
        )

        directChildren.forEach((child) => {
          elementInfo.children.push(buildElementInfo(child))
        })

        return elementInfo
      }

      return rootElements.map(element => buildElementInfo(element))
    }
  }
}
