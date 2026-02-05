/**
 * Element Selection Manager for element selection, highlighting, and badge management
 */

import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom'
import type { ElementData } from '../rpc/define'
import type { ComponentInfo } from './detectors'
import { XPathUtils } from '../utils/xpath'
import { Z_INDEX, SELECTION_COLORS, TEXT_SELECTION, COLORS, FONTS } from './constants'

/**
 * Metadata for a text selection annotation.
 * Created when user selects text (not an element) for annotation.
 */
export interface TextSelectionInfo {
  /** The actual text content that was selected by the user */
  selectedText: string
  /** The nearest common ancestor element containing the entire selection */
  containerElement: Element
}

export interface SelectedElementInfo {
  color: string
  index: number
  displayText: string // Store for reindexing
  textSelection?: TextSelectionInfo // Present if this is a text selection
}

// Selection group - all UI elements for one selected element share ONE position tracker
interface SelectionGroup {
  badge: HTMLElement
  overlay: HTMLElement
  cleanup: () => void
}

// Component finder function type
type ComponentFinder = (el: Element) => ComponentInfo | null

export interface WrapTextRangeResult {
  wrapper: Element
  textSelection: TextSelectionInfo
}

export interface ElementSelectionManager {
  selectElement(element: Element, componentFinder?: ComponentFinder, textSelection?: TextSelectionInfo): void
  wrapTextRange(range: Range, containerElement: Element): WrapTextRangeResult | null
  deselectElement(element: Element): void
  clearAllSelections(): void
  hasElement(element: Element): boolean
  getSelectedElements(): Map<Element, SelectedElementInfo>
  getSelectedCount(): number
  findSelectedParent(element: Element): Element | null
  findSelectedChildren(element: Element): Element[]
  buildHierarchicalStructure(componentFinder?: ComponentFinder, imagePaths?: Map<Element, string>): ElementData[]
  setOnEditClick(callback: (element: Element) => void): void
  getBadgeForElement(element: Element): HTMLElement | null
}

export function createElementSelectionManager(): ElementSelectionManager {
  const selectedElements = new Map<Element, SelectedElementInfo>()
  const selectionGroups = new Map<Element, SelectionGroup>()
  let colorIndex = 0
  let onEditClickCallback: ((element: Element) => void) | null = null
  let keyframesStyleElement: HTMLStyleElement | null = null

  /**
   * Unwraps a text selection span, restoring children to their original position.
   * Safely handles the case where the element was already removed from the DOM.
   */
  function unwrapTextSelection(element: Element): void {
    const parent = element.parentNode
    if (!parent) {
      // Element was already removed from DOM (e.g., by framework re-render)
      console.warn('[AI Annotator] Cannot unwrap text selection: element has no parent')
      return
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element)
    }
    element.remove()
  }

  function getDisplayText(index: number, element: Element, componentFinder?: ComponentFinder, textSelection?: TextSelectionInfo): string {
    if (textSelection) {
      const preview = textSelection.selectedText.substring(0, 15)
      const ellipsis = textSelection.selectedText.length > 15 ? '...' : ''
      return `#${index} "${preview}${ellipsis}"`
    }
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
    const textColor = COLORS.BADGE_TEXT
    const glowColor = color.toLowerCase()

    // --- Create Badge ---
    const badge = document.createElement('div')
    badge.classList.add('annotator-badge')

    const shadow = badge.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      @import url('${FONTS.GOOGLE_FONTS_URL}');

      @keyframes badge-glow {
        0%, 100% { box-shadow: 2px 2px 0px ${color}44, 0 0 8px ${glowColor}80; }
        50% { box-shadow: 2px 2px 0px ${color}66, 0 0 15px ${glowColor}aa; }
      }

      .badge-container {
        display: flex;
        align-items: center;
        border: 1px solid ${color};
        background: ${COLORS.BADGE_BG};
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
        font-family: ${FONTS.MONO};
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
    selectElement(element: Element, componentFinder?: ComponentFinder, textSelection?: TextSelectionInfo): void {
      const color = SELECTION_COLORS[colorIndex % SELECTION_COLORS.length]
      const index = selectedElements.size + 1
      colorIndex++

      // Get display text for badge (preserves component info for reindexing)
      const displayText = getDisplayText(index, element, componentFinder, textSelection)

      // Create selection group with ONE autoUpdate for both badge and overlay
      const group = createSelectionGroup(element, color, displayText)
      selectionGroups.set(element, group)

      selectedElements.set(element, { color, index, displayText, textSelection })
    },

    wrapTextRange(range: Range, containerElement: Element): WrapTextRangeResult | null {
      const selectedText = range.toString().trim()
      if (!selectedText) return null

      // Enforce maximum text selection length
      if (selectedText.length > TEXT_SELECTION.MAX_LENGTH) {
        console.warn(`[AI Annotator] Text selection exceeds maximum length of ${TEXT_SELECTION.MAX_LENGTH} characters`)
        return null
      }

      // Get the next color in the palette for this text selection (peek, don't increment)
      const highlightColor = SELECTION_COLORS[colorIndex % SELECTION_COLORS.length]

      // Create wrapper span around selected text
      const wrapper = document.createElement('span')
      wrapper.className = 'annotator-text-selection annotator-ignore'
      wrapper.style.cssText = `
        background: ${highlightColor}4D;
        border-radius: 2px;
      `

      try {
        // surroundContents works when selection is within a single element's text
        // Throws DOMException if range partially selects non-text nodes
        range.surroundContents(wrapper)
      } catch {
        // Cross-element selection: surroundContents fails when selection spans multiple elements
        console.warn('[AI Annotator] Cannot wrap cross-element text selection. Please select text within a single paragraph.')
        return null
      }

      // Return wrapper and text selection info - caller will call selectElement
      return {
        wrapper,
        textSelection: {
          selectedText,
          containerElement
        }
      }
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

        // If this was a text selection, unwrap the span
        if (elementData.textSelection && element.classList.contains('annotator-text-selection')) {
          unwrapTextSelection(element)
        }

        selectedElements.delete(element)
        reindexElements()
      }
    },

    clearAllSelections(): void {
      // Remove all selection groups and unwrap text selections
      selectionGroups.forEach((group, element) => {
        group.cleanup()
        group.badge.remove()
        group.overlay.remove()

        // If this was a text selection, unwrap the span
        const elementData = selectedElements.get(element)
        if (elementData?.textSelection && element.classList.contains('annotator-text-selection')) {
          unwrapTextSelection(element)
        }
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

    getBadgeForElement(element: Element): HTMLElement | null {
      const group = selectionGroups.get(element)
      return group?.badge || null
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

        // For text selections, use the container element for xpath/cssSelector
        const targetElement = data.textSelection?.containerElement || element

        const elementInfo: ElementData = {
          index: data.index,
          tagName: targetElement.tagName,
          xpath: XPathUtils.generateXPath(targetElement),
          cssSelector: XPathUtils.generateEnhancedCSSSelector(targetElement),
          textContent: element.textContent?.substring(0, 100) || '',
          attributes: Array.from(targetElement.attributes).reduce((acc, attr) => {
            if (attr.name !== 'style') {
              acc[attr.name] = attr.value
            }
            return acc
          }, {} as Record<string, string>),
          children: [],
        }

        // Add text selection metadata if present and container is still in DOM
        if (data.textSelection && data.textSelection.containerElement.isConnected) {
          elementInfo.textSelection = {
            selectedText: data.textSelection.selectedText,
            containerXPath: XPathUtils.generateXPath(data.textSelection.containerElement),
            containerCssSelector: XPathUtils.generateEnhancedCSSSelector(data.textSelection.containerElement)
          }
        } else if (data.textSelection) {
          // Container was removed from DOM (e.g., by framework re-render)
          // Still include text but mark container as unavailable
          elementInfo.textSelection = {
            selectedText: data.textSelection.selectedText,
            containerXPath: '',
            containerCssSelector: ''
          }
        }

        // Add image path if available
        if (imagePaths && imagePaths.has(element)) {
          elementInfo.imagePath = imagePaths.get(element)
        }

        // Add computed styles
        try {
          const htmlElement = targetElement as HTMLElement
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
