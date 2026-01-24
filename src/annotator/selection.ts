/**
 * Element Selection Manager for element selection, highlighting, and badge management
 */

import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom'
import type { ElementData } from '../rpc/define'
import type { ComponentInfo } from './detectors'
import { XPathUtils } from '../utils/xpath'

export interface SelectedElementInfo {
  color: string
  originalOutline: string
  originalOutlineOffset: string
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
  updateBadgeCommentIndicator(element: Element, hasComment: boolean): void
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

  function createPencilIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2')

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    path.setAttribute('d', 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10')

    svg.appendChild(path)
    return svg
  }

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
        pointer-events: none;
        white-space: nowrap;
        text-transform: uppercase;
      }
      .edit-btn {
        height: 14px;
        width: 18px;
        background-color: transparent;
        border: none;
        border-left: 1px solid ${color}44;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: auto;
        transition: all 0.1s ease;
      }
      .edit-btn:hover {
        background-color: ${color};
      }
      .edit-btn svg {
        width: 10px;
        height: 10px;
        color: ${color};
        opacity: 0.8;
      }
      .edit-btn:hover svg {
        color: ${textColor};
        opacity: 1;
      }
      .edit-btn.has-comment svg {
        opacity: 1;
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

    const editBtn = document.createElement('button')
    editBtn.classList.add('edit-btn', 'annotator-ignore')
    editBtn.title = 'Edit comment'
    editBtn.appendChild(createPencilIcon())

    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      if (onEditClickCallback) {
        onEditClickCallback(element)
      }
    })

    container.appendChild(badgeContent)
    container.appendChild(editBtn)
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
      const originalOutline = el.style.outline
      const originalOutlineOffset = el.style.outlineOffset

      el.style.outline = `2px dashed ${color}`
      el.style.outlineOffset = '2px'

      const badge = createBadge(index, color, element, componentFinder)
      badges.set(element, badge)

      selectedElements.set(element, {
        color,
        originalOutline,
        originalOutlineOffset,
        index,
      })
    },

    deselectElement(element: Element): void {
      const elementData = selectedElements.get(element)
      if (elementData) {
        const el = element as HTMLElement
        if (elementData.originalOutline) {
          el.style.outline = elementData.originalOutline
        } else {
          el.style.removeProperty('outline')
        }
        if (elementData.originalOutlineOffset) {
          el.style.outlineOffset = elementData.originalOutlineOffset
        } else {
          el.style.removeProperty('outline-offset')
        }

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
      selectedElements.forEach((data, element) => {
        const el = element as HTMLElement
        if (data.originalOutline) {
          el.style.outline = data.originalOutline
        } else {
          el.style.removeProperty('outline')
        }
        if (data.originalOutlineOffset) {
          el.style.outlineOffset = data.originalOutlineOffset
        } else {
          el.style.removeProperty('outline-offset')
        }
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

    updateBadgeCommentIndicator(element: Element, hasComment: boolean): void {
      const badge = badges.get(element)
      if (badge) {
        const editBtn = badge.shadowRoot?.querySelector('.edit-btn')
        if (editBtn) {
          if (hasComment) {
            editBtn.classList.add('has-comment')
          } else {
            editBtn.classList.remove('has-comment')
          }
        }
      }
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
