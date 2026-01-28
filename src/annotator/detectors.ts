/**
 * Framework component detection and file location extraction
 */

import { createLogger } from '../utils/logger'
import { XPathUtils, ElementSelector } from '../utils/xpath'

// Internal framework property interfaces (undocumented browser internals)
interface ReactFiberType {
  name?: string
  displayName?: string
  __source?: { fileName?: string }
  prototype?: { render?: unknown }
}

interface ReactFiber {
  type?: ReactFiberType | string
  return?: ReactFiber
  _debugOwner?: ReactFiber
  _debugSource?: {
    fileName?: string
    lineNumber?: number
    columnNumber?: number
  }
}

interface VueVNode {
  props?: { __v_inspector?: string }
  loc?: {
    source?: string
    start?: { line?: number; column?: number; offset?: number }
    end?: { line?: number; column?: number; offset?: number }
  }
  type?: { name?: string; __v_inspector?: string }
  componentOptions?: { __v_inspector?: string }
  __v_inspector?: string
  __source?: {
    line?: number
    column?: number
    file?: string
    name?: string
  }
}

interface VueInstance {
  __v_inspector?: string
  $options?: { __v_inspector?: string }
  type?: { __v_inspector?: string }
  vnode?: VueVNode
}

interface ElementWithFrameworkProps extends Element {
  __vnode?: VueVNode
  __vueParentComponent?: VueInstance
  __vue__?: VueInstance
  __v_inspector?: string
  $vnode?: VueVNode
  [key: `__reactFiber${string}`]: ReactFiber | undefined
  [key: `__reactInternalInstance${string}`]: ReactFiber | undefined
  [key: `_reactInternalFiber${string}`]: ReactFiber | undefined
}

export interface ComponentInfo {
  componentLocation: string
  componentName?: string
  // Enhanced element-specific location data
  elementLocation?: {
    file: string
    line: number
    column: number
    endLine?: number
    endColumn?: number
    source?: string // The actual source code of this element
  }
  // Framework-specific metadata
  framework?: 'vue' | 'react' | 'angular' | 'svelte' | 'vanilla'
  // Source map data for precise mapping
  sourceMap?: {
    originalLine: number
    originalColumn: number
    originalSource: string
    originalName?: string
  }
  // Element hierarchy in source (e.g., "Button > .content > span")
  sourceHierarchy?: string
  // Enhanced selector information for robust element identification
  selectors?: {
    primary: ElementSelector
    fallbacks: string[]
    confidence: 'high' | 'medium' | 'low'
  }
}

/**
 * Find the nearest component in the DOM tree
 */
export function findNearestComponent(element: Element, verbose = false): ComponentInfo | null {
  if (!element || element === document.body) return null

  const logger = createLogger(verbose)

  try {
    // Try Vue detection first (works for Vue 2 and Vue 3)
    let componentInfo = getVueComponentInfo(element)
    
    // Debug logging
    const el = element as ElementWithFrameworkProps
    if (componentInfo) {
      logger.log('🟢 Vue component found:', componentInfo)
    } else {
      logger.log('🔍 No Vue component found for element:', element.tagName, 'Checking properties:', {
        __vnode: !!el.__vnode,
        __vueParentComponent: !!el.__vueParentComponent,
        __vue__: !!el.__vue__,
        __v_inspector: !!el.__v_inspector
      })
    }
    
    // If Vue detection fails, try React detection
    if (!componentInfo) {
      componentInfo = getReactComponentInfo(element)
      if (componentInfo) {
        logger.log('🔵 React component found:', componentInfo)
      }
    }

    // If React detection fails, try vanilla component attributes
    if (!componentInfo) {
      componentInfo = getVanillaComponentInfo(element)
      if (componentInfo) {
        logger.log('🟡 Vanilla component found:', componentInfo)
      }
    }

    if (componentInfo) {
      // Enhance with selector information
      try {
        const selectorInfo = XPathUtils.generateRobustSelectors(element)
        componentInfo.selectors = selectorInfo
        
        if (verbose) {
          logger.log('🎯 Generated selectors:', {
            xpath: selectorInfo.primary.xpath,
            css: selectorInfo.primary.cssSelector,
            confidence: selectorInfo.confidence,
            fallbacks: selectorInfo.fallbacks.length
          })
        }
      } catch (error) {
        if (verbose) {
          logger.warn('Failed to generate selectors:', error)
        }
      }
      
      return componentInfo
    }

    return findNearestComponent(element.parentElement!, verbose)
  } catch (e) {
    logger.error('Error finding nearest component:', e)
    return null
  }
}

/**
 * Extract React component information from DOM elements
 */
function getReactComponentInfo(element: Element): ComponentInfo | null {
  if (!element) return null

  const el = element as ElementWithFrameworkProps

  // Try different React fiber properties
  const fiberKey = Object.keys(el).find(key =>
    key.startsWith('__reactFiber') ||
    key.startsWith('__reactInternalInstance') ||
    key.startsWith('_reactInternalFiber')
  ) as keyof ElementWithFrameworkProps | undefined

  if (!fiberKey) {
    return null
  }

  const fiber = el[fiberKey] as ReactFiber | undefined
  if (!fiber) {
    return null
  }

  try {
    const componentInfo = extractReactComponentInfo(fiber, element)
    return componentInfo
  } catch (error) {
    console.warn('Failed to extract React component info:', error)
    return null
  }
}

/**
 * Extract component information from React fiber
 */
function extractReactComponentInfo(fiber: ReactFiber, element: Element): ComponentInfo | null {
  if (!fiber) return null

  let currentFiber: ReactFiber | undefined = fiber
  let componentName = ''
  let componentFile = ''

  // Walk up the fiber tree to find component information
  while (currentFiber) {
    const fiberType = currentFiber.type
    // Look for component name (function component)
    if (fiberType && typeof fiberType === 'object') {
      componentName = fiberType.name || fiberType.displayName || 'Anonymous'

      // Try to get file location from React DevTools source mapping
      if (fiberType.__source) {
        componentFile = fiberType.__source.fileName || ''
      }

      // Also check for component classes
      if (fiberType.prototype?.render) {
        componentName = fiberType.name || 'Component'
      }

      break
    }

    currentFiber = currentFiber.return ?? currentFiber._debugOwner
  }

  if (!componentName && !componentFile) {
    return null
  }

  const componentInfo: ComponentInfo = {
    componentLocation: componentFile ? `${componentFile}@${componentName}` : componentName,
    componentName,
    framework: 'react'
  }

  // Try to extract element-specific location information
  const elementLocationInfo = extractReactElementLocation(fiber, element)
  if (elementLocationInfo) {
    Object.assign(componentInfo, elementLocationInfo)
  }

  return componentInfo
}

/**
 * Extract element-specific location data from React fiber
 */
function extractReactElementLocation(fiber: ReactFiber, element: Element): Partial<ComponentInfo> | null {
  try {
    const locationInfo: Partial<ComponentInfo> = {}

    // Try to get element-specific location from React source mapping
    if (fiber._debugSource) {
      locationInfo.elementLocation = {
        file: fiber._debugSource.fileName || '',
        line: fiber._debugSource.lineNumber || 0,
        column: fiber._debugSource.columnNumber || 0
      }
    }

    // Build source hierarchy from React component tree
    const hierarchy = buildReactSourceHierarchy(fiber, element)
    if (hierarchy) {
      locationInfo.sourceHierarchy = hierarchy
    }

    // Look for source map information in React DevTools
    const sourceMapInfo = extractReactSourceMap(fiber)
    if (sourceMapInfo) {
      locationInfo.sourceMap = sourceMapInfo
    }

    return Object.keys(locationInfo).length > 0 ? locationInfo : null
  } catch (error) {
    console.warn('Failed to extract React element location:', error)
    return null
  }
}

/**
 * Build source hierarchy from React component tree
 */
function buildReactSourceHierarchy(fiber: ReactFiber, element: Element): string | null {
  try {
    const parts: string[] = []
    let currentFiber: ReactFiber | undefined = fiber

    // Walk up the fiber tree to build hierarchy
    while (currentFiber && parts.length < 3) { // Limit depth to avoid noise
      const fiberType = currentFiber.type
      if (fiberType && typeof fiberType === 'object') {
        const name = fiberType.name || fiberType.displayName
        if (name && name !== 'Fragment') {
          parts.unshift(name)
        }
      } else if (fiberType && typeof fiberType === 'string') {
        // DOM element
        parts.push(fiberType)
      }

      currentFiber = currentFiber.return
    }

    // Add element classes if meaningful
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c && !c.includes('css-') && !c.includes('emotion-'))
        .slice(0, 2) // Limit to avoid noise
      
      if (classes.length > 0) {
        parts.push('.' + classes.join('.'))
      }
    }

    return parts.length > 0 ? parts.join(' > ') : null
  } catch (error) {
    return null
  }
}

/**
 * Extract source map information from React fiber
 */
function extractReactSourceMap(fiber: ReactFiber): ComponentInfo['sourceMap'] | null {
  try {
    // Look for source map data in React DevTools
    if (fiber._debugSource) {
      const fiberType = fiber.type
      const typeName = fiberType && typeof fiberType === 'object'
        ? (fiberType.name || fiberType.displayName)
        : undefined
      return {
        originalLine: fiber._debugSource.lineNumber || 0,
        originalColumn: fiber._debugSource.columnNumber || 0,
        originalSource: fiber._debugSource.fileName || '',
        originalName: typeName
      }
    }

    return null
  } catch (error) {
    return null
  }
}

function getVanillaComponentInfo(element: Element): ComponentInfo | null {
  // Check for injected source location (from vite-plugin-ai-annotator transform)
  const sourceLoc = element.getAttribute('data-source-loc')
  if (sourceLoc) {
    // Format: "path/to/file.html:line:column"
    const match = sourceLoc.match(/^(.+):(\d+):(\d+)$/)
    if (match) {
      const [, file, line, column] = match
      return {
        componentLocation: file,
        componentName: element.tagName.toLowerCase(),
        framework: 'vanilla',
        elementLocation: {
          file,
          line: parseInt(line, 10),
          column: parseInt(column, 10),
        },
        sourceMap: {
          originalLine: parseInt(line, 10),
          originalColumn: parseInt(column, 10),
          originalSource: file,
        },
      }
    }
  }

  // Legacy support for data-component-name/data-component-file
  const componentName = element.getAttribute('data-component-name')
  const componentFile = element.getAttribute('data-component-file')

  if (!componentName && !componentFile) {
    return null
  }

  return {
    componentLocation: `${componentFile}@${componentName}`,
    framework: 'vanilla'
  }
}

function getVueComponentInfo(element: Element): ComponentInfo | null {
  if (!element) return null

  const el = element as ElementWithFrameworkProps

  // Try multiple Vue property paths for different Vue versions and configurations

  // Vue 3 with __v_inspector in props
  let codeLocation = el.__vnode?.props?.__v_inspector
  let vueInstance: VueInstance | null = null
  let vnode: VueVNode | null = null

  // Vue 3 with context vnode (used by vite-plugin-vue-inspector)
  if (!codeLocation) {
    const ctxVNode = (el.__vnode as any)?.ctx?.vnode
    if (ctxVNode?.el === el) {
      codeLocation = ctxVNode?.props?.__v_inspector
    }
  }

  // Vue 3 with parent component
  if (!codeLocation) {
    codeLocation = el.__vueParentComponent?.vnode?.props?.__v_inspector
    vueInstance = el.__vueParentComponent ?? null
    vnode = el.__vueParentComponent?.vnode ?? null
  }

  // Direct __v_inspector on element
  if (!codeLocation) {
    codeLocation = el.__v_inspector
  }

  // Vue component instance with __v_inspector
  if (!codeLocation) {
    vueInstance = el.__vue__ ?? el.__vueParentComponent ?? null
    if (vueInstance) {
      codeLocation = vueInstance.__v_inspector ||
                    vueInstance.$options?.__v_inspector ||
                    vueInstance.type?.__v_inspector
    }
  }

  // Check vnode directly
  if (!codeLocation && !vnode) {
    vnode = el.__vnode ?? el.$vnode ?? null
    if (vnode) {
      codeLocation = vnode.__v_inspector ||
                    vnode.props?.__v_inspector ||
                    vnode.componentOptions?.__v_inspector
    }
  }

  // Fallback: Check data-v-inspector attribute (set by vite-plugin-vue-inspector / Nuxt DevTools)
  if (!codeLocation) {
    codeLocation = element.getAttribute('data-v-inspector') ?? undefined
  }

  if (!codeLocation) {
    return null
  }

  const componentInfo: ComponentInfo = {
    componentLocation: codeLocation,
    framework: 'vue'
  }

  // Try to extract element-specific location information
  const elementLocationInfo = extractVueElementLocation(element, vnode)
  if (elementLocationInfo) {
    Object.assign(componentInfo, elementLocationInfo)
  }

  return componentInfo
}

/**
 * Extract element-specific location data from Vue internals
 */
function extractVueElementLocation(element: Element, vnode: VueVNode | null): Partial<ComponentInfo> | null {
  try {
    const locationInfo: Partial<ComponentInfo> = {}

    // Try to get element-specific location from Vue devtools data
    if (vnode?.loc) {
      locationInfo.elementLocation = {
        file: vnode.loc.source || '',
        line: vnode.loc.start?.line || 0,
        column: vnode.loc.start?.column || 0,
        endLine: vnode.loc.end?.line,
        endColumn: vnode.loc.end?.column,
        source: vnode.loc.source?.slice(vnode.loc.start?.offset, vnode.loc.end?.offset)
      }
    }

    // Try to extract source hierarchy from Vue component tree
    if (vnode?.type?.name || element.tagName) {
      const hierarchy = buildVueSourceHierarchy(element, vnode)
      if (hierarchy) {
        locationInfo.sourceHierarchy = hierarchy
      }
    }

    // Look for source map information
    const sourceMapInfo = extractVueSourceMap(vnode)
    if (sourceMapInfo) {
      locationInfo.sourceMap = sourceMapInfo
    }

    return Object.keys(locationInfo).length > 0 ? locationInfo : null
  } catch (error) {
    console.warn('Failed to extract Vue element location:', error)
    return null
  }
}

/**
 * Build source hierarchy from Vue component tree
 */
function buildVueSourceHierarchy(element: Element, vnode: VueVNode | null): string | null {
  try {
    const parts: string[] = []
    
    // Add component name if available
    if (vnode?.type?.name) {
      parts.push(vnode.type.name)
    }
    
    // Add element tag or component tag
    if (element.tagName && element.tagName.toLowerCase() !== 'div') {
      parts.push(element.tagName.toLowerCase())
    }
    
    // Add class hierarchy if meaningful
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c && !c.startsWith('v-') && !c.includes('transition'))
        .slice(0, 2) // Limit to avoid noise
      
      if (classes.length > 0) {
        parts.push('.' + classes.join('.'))
      }
    }

    return parts.length > 0 ? parts.join(' > ') : null
  } catch (error) {
    return null
  }
}

/**
 * Extract source map information from Vue internals
 */
function extractVueSourceMap(vnode: VueVNode | null): ComponentInfo['sourceMap'] | null {
  try {
    // Look for source map data in Vue internals
    // This is framework-specific and may vary by Vue version
    if (vnode?.__source) {
      return {
        originalLine: vnode.__source.line || 0,
        originalColumn: vnode.__source.column || 0,
        originalSource: vnode.__source.file || '',
        originalName: vnode.__source.name
      }
    }

    return null
  } catch (error) {
    return null
  }
}

