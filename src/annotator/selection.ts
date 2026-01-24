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
}

// Badge element with cleanup function attached
interface BadgeElement extends HTMLElement {
  _cleanup?: () => void
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
  const badges = new Map<Element, BadgeElement>()
  let colorIndex = 0
  let onEditClickCallback: ((element: Element) => void) | null = null
  // Cyberpunk color palette
  const colors = [
    '#FF00FF', // cyber-pink
    '#00FFFF', // cyber-cyan
    '#FFFF00', // cyber-yellow
    '#FF00FF',
    '#00FFFF',
    '#FFFF00',
    '#FF00FF',
    '#00FFFF',
    '#FFFF00',
    '#FF00FF',
  ]

  function createBadge(
    index: number,
    color: string,
    element: Element,
    componentFinder?: ComponentFinder
  ): BadgeElement {
    const badge = document.createElement('div') as BadgeElement
    badge.classList.add('annotator-badge')

    const shadow = badge.attachShadow({ mode: 'open' })

    // Determine text color based on background
    const textColor = color === '#FFFF00' ? '#050505' : '#050505'
    const glowColor = color.toLowerCase()

    const style = document.createElement('style')
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');

      @keyframes badge-glow {
        0%, 100% {
          box-shadow: 2px 2px 0px ${color}44, 0 0 8px ${glowColor}80;
        }
        50% {
          box-shadow: 2px 2px 0px ${color}66, 0 0 15px ${glowColor}aa;
        }
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

    const component = componentFinder?.(element)
    if (component && component.componentLocation) {
      const componentPath = component.componentLocation.split('@')[0]
      const fileName = componentPath.split('/').pop()
      badgeContent.textContent = `#${index} ${fileName}`
    } else {
      badgeContent.textContent = `#${index} ${element.tagName}`
    }

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

    badge.style.position = 'fixed'
    badge.style.top = '0'
    badge.style.left = '0'
    badge.style.zIndex = '999998'

    document.body.appendChild(badge)

    // Use floating-ui for positioning with auto-update
    const cleanup = autoUpdate(element, badge, () => {
      computePosition(element, badge, {
        strategy: 'fixed',
        placement: 'top-start',
        middleware: [
          offset({ mainAxis: -5, crossAxis: 7 }),
          flip({ fallbackPlacements: ['bottom-start', 'top-end', 'bottom-end'] }),
          shift({ padding: 5 }),
        ],
      }).then(({ x, y }) => {
        Object.assign(badge.style, {
          left: `${x}px`,
          top: `${y}px`,
        })
      })
    })

    badge._cleanup = cleanup

    return badge
  }

  function reindexElements(): void {
    let index = 1

    selectedElements.forEach((data, element) => {
      data.index = index

      const badge = badges.get(element)
      if (badge) {
        const badgeContent = badge.shadowRoot?.querySelector('.badge')
        if (badgeContent) {
          badgeContent.textContent = `#${index} ${element.tagName}`
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

      const el = element as HTMLElement
      el.style.outline = `2px dashed ${color}`
      el.style.outlineOffset = '2px'

      const badge = createBadge(index, color, element, componentFinder)
      badges.set(element, badge)

      selectedElements.set(element, { color, index })
    },

    deselectElement(element: Element): void {
      const elementData = selectedElements.get(element)
      if (elementData) {
        const el = element as HTMLElement
        el.style.removeProperty('outline')
        el.style.removeProperty('outline-offset')

        const badge = badges.get(element)
        if (badge) {
          badge._cleanup?.()
          badge.remove()
          badges.delete(element)
        }

        selectedElements.delete(element)
        reindexElements()
      }
    },

    clearAllSelections(): void {
      selectedElements.forEach((_, element) => {
        const el = element as HTMLElement
        el.style.removeProperty('outline')
        el.style.removeProperty('outline-offset')
      })

      badges.forEach(badge => {
        badge._cleanup?.()
        badge.remove()
      })
      badges.clear()

      selectedElements.clear()
      colorIndex = 0
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
