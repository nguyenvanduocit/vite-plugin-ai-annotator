/**
 * AI Annotator Toolbar
 *
 * Browser component that:
 * 1. Connects to AI Annotator server via Socket.IO
 * 2. Handles RPC requests from server (element selection, screenshots, etc.)
 * 3. Shows toolbar UI with inspect/clear buttons
 * 4. Shows commentPopover for adding comments when elements are selected
 */

import { LitElement, html, css } from 'lit'
import { property, state } from 'lit/decorators.js'
import { io, Socket } from 'socket.io-client'
import { toBlob } from 'html-to-image'
import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom'

import { createElementSelectionManager, type ElementSelectionManager, type SelectedElementInfo } from './annotator/selection'
import { createInspectionManager, type InspectionManager } from './annotator/inspection'
import { findNearestComponent } from './annotator/detectors'
import type { ElementData, PageContext, SelectionResult, ScreenshotResult, ConsoleEntry, InjectResult } from './rpc/define'
import { createRpcClient, type RpcClient } from './rpc/client.generated'
import { isRpcError } from './rpc/types.generated'
import { CONSOLE_LIMITS, SCREENSHOT_TIMEOUT_MS } from './annotator/constants'
import { filterFeedbackFields, type FeedbackField } from './utils/feedback-fields'
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  fitLayout,
  hostPosition,
  layoutFromRect,
  parseLayout,
  sameLayout,
  type ToolbarLayout,
} from './annotator/toolbar-layout'

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

// Inlined into the clipboard prompt. Mirrors the field set the skill tells
// Claude to fetch, so a paste carries what the REST round-trip would return.
// `styles` and `children` stay opt-in — children is recursive and would bloat
// the clipboard — and remain reachable over REST.
const CLIPBOARD_FIELDS: FeedbackField[] = ['xpath', 'attributes']

// Pointer travel (px) before a press on the collapsed tab counts as a drag, not a tap.
const DRAG_THRESHOLD = 4
// Toolbars closer to the top than this show their toast below instead of above.
const TOAST_FLIP_TOP = 56

interface PopoverState {
  visible: boolean
  element: Element | null
  comment: string
}

interface TooltipState {
  visible: boolean
  text: string
  x: number
  y: number
}

export class AnnotatorToolbar extends LitElement {
  @property({ attribute: 'ws-endpoint' }) wsEndpoint = 'http://localhost:7318'
  @property({ attribute: 'verbose', type: Boolean }) verbose = false
  @property({ attribute: 'demo', type: Boolean }) demo = false

  @state() private connected = false
  @state() private sessionId = ''
  @state() private selectionCount = 0
  @state() private isInspecting = false
  @state() private commentPopover: PopoverState = { visible: false, element: null, comment: '' }
  @state() private tooltip: TooltipState = { visible: false, text: '', x: 0, y: 0 }
  @state() private toastMessage = ''
  // Number of Claude Code channel clients currently connected to the server.
  // > 0 enables the "Send to Claude" button; 0 disables it with a hint tooltip.
  @state() private channelListenerCount = 0
  // True when the server can reach the paseo CLI; shows "Send to Paseo".
  @state() private paseoConfigured = false
  // A send takes seconds (screenshots, then a new workspace); a second click
  // meanwhile would start a second agent on the same selection.
  @state() private paseoSending = false
  @state() private layout: ToolbarLayout = DEFAULT_LAYOUT
  private popoverCleanup: (() => void) | null = null
  private tooltipCleanup: (() => void) | null = null
  private toastTimeout: ReturnType<typeof setTimeout> | null = null
  private clickListenerTimeout: ReturnType<typeof setTimeout> | null = null
  private skipNextClickOutside = false

  private socket: Socket | null = null
  private rpc: RpcClient | null = null
  private selectionManager: ElementSelectionManager | null = null
  private inspectionManager: InspectionManager | null = null
  private elementComments = new Map<Element, string>()
  private consoleBuffer: ConsoleEntry[] = []
  private originalConsoleMethods: Partial<Record<keyof Console, (...args: unknown[]) => void>> = {}

  static styles = css`
    :host {
      --cyber-pink: #FF00FF;
      --cyber-cyan: #00FFFF;
      --cyber-yellow: #FFFF00;
      --cyber-black: #050505;
      --cyber-gray: #121212;

      position: fixed;
      z-index: 999999;
      font-family: 'JetBrains Mono', monospace;
    }

    .toolbar {
      position: relative;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px;
      background: var(--cyber-black);
      border: 2px solid var(--cyber-cyan);
      box-shadow: 4px 4px 0px rgba(0, 255, 255, 0.3), 0 0 20px rgba(0, 255, 255, 0.2);
    }

    .toolbar-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--cyber-cyan);
      cursor: pointer;
      transition: all 0.1s ease;
    }

    .toolbar-btn:hover {
      background: rgba(0, 255, 255, 0.1);
      color: var(--cyber-yellow);
      border-color: var(--cyber-cyan);
    }

    .toolbar-btn:disabled {
      opacity: 0.4;
      cursor: progress;
    }

    .toolbar-btn:disabled:hover {
      background: transparent;
      color: var(--cyber-cyan);
      border-color: transparent;
    }

    .toolbar-btn.active {
      background: var(--cyber-pink);
      color: var(--cyber-black);
      border-color: var(--cyber-pink);
      box-shadow: 0 0 10px rgba(255, 0, 255, 0.5);
    }

    .toolbar-btn.active:hover {
      background: var(--cyber-yellow);
      color: var(--cyber-black);
      border-color: var(--cyber-yellow);
    }

    .drag-handle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 32px;
      color: rgba(0, 255, 255, 0.5);
      cursor: grab;
      touch-action: none;
      user-select: none;
    }

    .drag-handle:hover {
      color: var(--cyber-cyan);
    }

    .drag-handle svg {
      width: 12px;
      height: 18px;
    }

    .dragging,
    .dragging * {
      cursor: grabbing !important;
    }

    /* Collapsed: a small tab flush against the screen edge */
    .dock-tab {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 44px;
      padding: 0;
      background: var(--cyber-black);
      color: var(--cyber-cyan);
      border: 2px solid var(--cyber-cyan);
      cursor: pointer;
      touch-action: none;
      box-shadow: 0 0 20px rgba(0, 255, 255, 0.2);
    }

    .dock-tab.left {
      border-left: none;
    }

    .dock-tab.right {
      border-right: none;
    }

    .dock-tab:hover {
      color: var(--cyber-yellow);
    }

    .dock-tab svg {
      width: 14px;
      height: 14px;
    }

    .dock-tab .badge {
      top: -8px;
    }

    .dock-tab.left .badge {
      right: -10px;
    }

    .dock-tab.right .badge {
      right: auto;
      left: -10px;
    }

    .toolbar-btn svg {
      width: 18px;
      height: 18px;
    }

    .divider {
      width: 1px;
      height: 20px;
      background: rgba(0, 255, 255, 0.3);
      margin: 0 4px;
    }

    .btn-with-badge {
      position: relative;
    }

    .badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      background: var(--cyber-pink);
      border: 1px solid var(--cyber-black);
      font-size: 9px;
      font-weight: 700;
      color: var(--cyber-black);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      box-shadow: 0 0 8px rgba(255, 0, 255, 0.5);
    }

    .error-message {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      color: var(--cyber-pink);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .error-message svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    /* Cyberpunk Popover */
    .popover {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 1000000;
      display: flex;
      flex-direction: column;
      background: var(--cyber-black);
      border: 2px solid var(--cyber-cyan);
      box-shadow: 4px 4px 0px rgba(0, 255, 255, 0.3), 0 0 30px rgba(0, 255, 255, 0.2);
      animation: popover-in 0.15s ease-out;
    }


    @keyframes popover-in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .popover-input {
      width: 240px;
      max-height: 120px;
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: var(--cyber-yellow);
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
      outline: none;
      resize: none;
      overflow-y: auto;
      line-height: 1.4;
      box-sizing: border-box;
    }

    .popover-input::placeholder {
      color: rgba(0, 255, 255, 0.4);
    }

    .popover-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      padding: 6px 8px;
      border-top: 1px solid rgba(0, 255, 255, 0.2);
    }

    .popover-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: 1px solid rgba(0, 255, 255, 0.3);
      background: transparent;
      color: rgba(0, 255, 255, 0.6);
      cursor: pointer;
      transition: all 0.1s ease;
    }

    .popover-btn:hover {
      background: rgba(0, 255, 255, 0.1);
      color: var(--cyber-cyan);
      border-color: var(--cyber-cyan);
    }

    .popover-btn.danger:hover {
      background: rgba(255, 0, 255, 0.1);
      color: var(--cyber-pink);
      border-color: var(--cyber-pink);
    }

    .popover-btn svg {
      width: 14px;
      height: 14px;
    }

    .hidden {
      display: none;
    }

    /* Cyberpunk Toast */
    .toast {
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 8px;
      padding: 6px 12px;
      background: var(--cyber-black);
      border: 1px solid var(--cyber-cyan);
      font-size: 10px;
      font-weight: 700;
      color: var(--cyber-cyan);
      white-space: nowrap;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      animation: toast-in 0.2s ease-out;
      box-shadow: 2px 2px 0px rgba(0, 255, 255, 0.3), 0 0 15px rgba(0, 255, 255, 0.2);
    }

    .toast.toast-left {
      left: 0;
      right: auto;
    }

    .toast.toast-below {
      bottom: auto;
      top: 100%;
      margin-bottom: 0;
      margin-top: 8px;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Cyberpunk Tooltip */
    .tooltip {
      position: fixed;
      z-index: 1000001;
      padding: 4px 8px;
      background: var(--cyber-black);
      border: 1px solid var(--cyber-cyan);
      font-size: 10px;
      font-weight: 700;
      color: var(--cyber-cyan);
      white-space: nowrap;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      pointer-events: none;
      animation: tooltip-in 0.1s ease-out;
      box-shadow: 2px 2px 0px rgba(0, 255, 255, 0.3), 0 0 10px rgba(0, 255, 255, 0.15);
    }

    @keyframes tooltip-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `

  connectedCallback() {
    super.connectedCallback()
    // Load Google Fonts via <link> since @import is not supported in constructable stylesheets
    if (!document.querySelector('link[href*="JetBrains+Mono"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap'
      document.head.appendChild(link)
    }
    this.layout = this.loadLayout()
    window.addEventListener('resize', this.handleWindowResize)
    this.initializeManagers()
    if (this.demo) {
      this.connected = true
    } else {
      this.initializeConsoleCapture()
      this.connectToServer()
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('resize', this.handleWindowResize)
    this.cleanup()
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    // Width changes with connection state, the Paseo button, and collapse/expand,
    // so re-fit whenever one of them may have moved the toolbar off-screen.
    if (changed.has('layout')) this.applyLayout()
    if (changed.has('layout') || changed.has('connected') || changed.has('paseoConfigured')) this.fitToViewport()
  }

  // --- Placement: drag, collapse, persistence -------------------------------

  private loadLayout(): ToolbarLayout {
    try {
      return parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY))
    } catch {
      return DEFAULT_LAYOUT // storage blocked (privacy mode, sandboxed iframe)
    }
  }

  private commitLayout(next: ToolbarLayout) {
    if (sameLayout(next, this.layout)) return
    this.layout = next
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next))
    } catch {
      this.log('Toolbar layout not persisted: storage unavailable')
    }
  }

  private applyLayout() {
    Object.assign(this.style, hostPosition(this.layout))
  }

  // clientWidth/Height exclude scrollbars, matching the box `position: fixed` is laid out in.
  private get viewport() {
    const { clientWidth, clientHeight } = document.documentElement
    return { width: clientWidth, height: clientHeight }
  }

  private fitToViewport() {
    const rect = this.getBoundingClientRect()
    this.commitLayout(fitLayout(this.layout, { width: rect.width, height: rect.height }, this.viewport))
  }

  private handleWindowResize = () => this.fitToViewport()

  private get toastBelow() {
    return this.layout.top !== null && this.layout.top < TOAST_FLIP_TOP
  }

  private toggleCollapsed() {
    this.hideTooltip()
    // Dock to whichever side the toolbar currently sits closer to.
    const docked = layoutFromRect(this.getBoundingClientRect(), this.viewport, !this.layout.collapsed)
    this.commitLayout({ ...this.layout, side: docked.side, collapsed: !this.layout.collapsed })
  }

  // Moves the fixed host with the pointer, then stores where it was dropped.
  // `onTap` runs instead when the pointer never travelled past DRAG_THRESHOLD.
  private startDrag(event: PointerEvent, onTap?: () => void) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    this.hideTooltip()

    const start = this.getBoundingClientRect()
    const originX = event.clientX
    const originY = event.clientY
    let moved = false

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - originX
      const dy = e.clientY - originY
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      moved = true
      handle.classList.add('dragging')
      Object.assign(this.style, {
        left: `${start.left + dx}px`,
        top: `${start.top + dy}px`,
        right: 'auto',
        bottom: 'auto',
      })
    }

    const finish = (e: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      handle.releasePointerCapture(e.pointerId)
      handle.classList.remove('dragging')
      if (!moved) {
        onTap?.()
        return
      }
      const rect = this.getBoundingClientRect()
      const dropped = layoutFromRect(rect, this.viewport, this.layout.collapsed)
      // A collapsed tab always sits flush with its edge; keep the expanded inset for when it reopens.
      const inset = this.layout.collapsed ? this.layout.inset : dropped.inset
      const next = fitLayout({ ...dropped, inset }, { width: rect.width, height: rect.height }, this.viewport)
      if (sameLayout(next, this.layout)) this.applyLayout() // dropped back where it was: restore inline style
      else this.commitLayout(next)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  private initializeManagers() {
    this.selectionManager = createElementSelectionManager()

    // Set up edit callback for badge pencil icon click
    this.selectionManager.setOnEditClick((element) => {
      this.showCommentPopoverForElement(element)
    })

    this.inspectionManager = createInspectionManager({
      onElementSelect: (element) => this.handleElementSelected(element),
      onTextSelect: (range, commonAncestor) => this.handleTextSelected(range, commonAncestor),
      shouldIgnoreElement: (element) => this.shouldIgnoreElement(element),
      isElementSelected: (element) => this.selectionManager?.hasElement(element) || false,
      onEscape: () => this.exitInspectingMode(),
      onCopy: () => this.copySelectedElements(),
    })
  }

  private initializeConsoleCapture() {
    try {
      // Save all originals first (atomic - all or nothing)
      const originals: Partial<Record<typeof CONSOLE_METHODS[number], (...args: unknown[]) => void>> = {}
      CONSOLE_METHODS.forEach((method) => {
        originals[method] = console[method].bind(console)
      })

      // Then override all - if any fails, none are applied
      CONSOLE_METHODS.forEach((method) => {
        console[method] = (...args: unknown[]) => {
          try {
            const serializedArgs = args.map(arg => {
              try {
                const str = typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                return str.length > CONSOLE_LIMITS.MAX_ARG_LENGTH
                  ? str.slice(0, CONSOLE_LIMITS.MAX_ARG_LENGTH) + '...[truncated]'
                  : str
              } catch {
                return '[circular or unserializable]'
              }
            })

            this.consoleBuffer.push({
              type: method,
              args: serializedArgs,
              timestamp: Date.now()
            })

            // Hard limit: prevent memory issues from console spam
            if (this.consoleBuffer.length > CONSOLE_LIMITS.BUFFER_MAX) {
              this.consoleBuffer = this.consoleBuffer.slice(-CONSOLE_LIMITS.BUFFER_TRIM_TO)
            }

            // Call original method
            originals[method]?.(...args)
          } catch (captureError) {
            // If capture fails, still call original to not break app console
            originals[method]?.(...args)
          }
        }
      })

      // Only save originals after all overrides succeed
      this.originalConsoleMethods = originals
    } catch (error) {
      // Rollback on any error
      this.restoreConsoleMethods()
      throw error
    }
  }

  private restoreConsoleMethods() {
    CONSOLE_METHODS.forEach((method) => {
      if (this.originalConsoleMethods[method]) {
        console[method] = this.originalConsoleMethods[method] as (...args: unknown[]) => void
      }
    })
  }

  private connectToServer() {
    this.log('Connecting to', this.wsEndpoint)

    this.socket = io(this.wsEndpoint, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })

    // Create RPC client and register handlers
    this.rpc = createRpcClient(this.socket)
    this.registerRpcHandlers()

    this.socket.on('connect', () => {
      this.connected = true
      this.log('Connected to server')
      this.reportPageContext()
    })

    this.socket.on('connected', (data: { sessionId: string }) => {
      this.sessionId = data.sessionId
      this.log('Session ID:', this.sessionId)
    })

    this.socket.on('disconnect', () => {
      this.connected = false
      this.log('Disconnected from server')
    })

    this.socket.on('connect_error', (error: Error) => {
      this.log('Connection error:', error.message)
    })

    // Toast relayed from Claude via the channel plugin's notify_user tool.
    this.socket.on('channel:notify', (data: { message?: string; status?: string }) => {
      if (typeof data?.message !== 'string') return
      const prefix =
        data.status === 'done' ? '✓ ' :
        data.status === 'error' ? '✗ ' :
        data.status === 'progress' ? '… ' :
        ''
      this.showToast(prefix + data.message)
    })

    // Server tells us how many Claude Code channel clients are listening so
    // we can enable/disable the "Send to Claude" button.
    this.socket.on('channel:status', (data: { listenerCount?: number }) => {
      this.channelListenerCount = typeof data?.listenerCount === 'number' ? data.listenerCount : 0
    })

    this.socket.on('paseo:status', (data: { configured?: boolean }) => {
      this.paseoConfigured = data?.configured === true
    })
  }

  private wrapRpcHandler<T extends (...args: any[]) => any>(name: string, handler: T): T {
    return (async (...args: any[]) => {
      try { return await handler(...args) }
      catch (error) {
        this.log(`[${name}] Handler error:`, error)
        throw { message: error instanceof Error ? error.message : String(error), code: 'INTERNAL_ERROR', data: undefined } as const
      }
    }) as unknown as T
  }

  private registerRpcHandlers() {
    if (!this.rpc) return

    this.rpc.handle.getPageContext(this.wrapRpcHandler('getPageContext', async () => this.getPageContext()))
    this.rpc.handle.getSelectedElements(this.wrapRpcHandler('getSelectedElements', async () => (await this.collectFeedback()).elements))
    this.rpc.handle.triggerSelection(this.wrapRpcHandler('triggerSelection', async (mode, selector, selectorType) => this.triggerSelection(mode, selector, selectorType)))
    this.rpc.handle.captureScreenshot(this.wrapRpcHandler('captureScreenshot', async (type, selector, quality) => this.captureScreenshot(type, selector, quality)))
    this.rpc.handle.clearSelection(this.wrapRpcHandler('clearSelection', async () => this.clearSelection()))
    this.rpc.handle.ping(async () => 'pong')
    this.rpc.handle.injectCSS(this.wrapRpcHandler('injectCSS', async (css) => this.injectCSS(css)))
    this.rpc.handle.injectJS(this.wrapRpcHandler('injectJS', async (code) => this.injectJS(code)))
    this.rpc.handle.getConsole(this.wrapRpcHandler('getConsole', async (clear) => this.getConsoleLogs(clear)))
  }
  private reportPageContext() {
    if (!this.socket?.connected) return

    this.socket.emit('pageContextChanged', {
      url: window.location.href,
      title: document.title,
    })
  }

  private getPageContext(): PageContext {
    return {
      url: window.location.href,
      title: document.title,
      selectionCount: this.selectionCount,
      isInspecting: this.isInspecting,
    }
  }

  private getSelectedElements(imagePaths?: Map<Element, string>): ElementData[] {
    if (!this.selectionManager) return []

    const elements = this.selectionManager.buildHierarchicalStructure(
      (el) => findNearestComponent(el, this.verbose),
      imagePaths
    )

    this.enrichElementsWithComments(elements, this.selectionManager.getSelectedElements())
    return elements
  }

  private enrichElementsWithComments(items: ElementData[], selectedElements: Map<Element, SelectedElementInfo>) {
    for (const item of items) {
      // Find element by index
      for (const [element, info] of selectedElements) {
        if (info.index === item.index) {
          const comment = this.elementComments.get(element)
          if (comment) {
            item.comment = comment
          }
          break
        }
      }
      if (item.children.length > 0) {
        this.enrichElementsWithComments(item.children, selectedElements)
      }
    }
  }

  private triggerSelection(
    mode: 'inspect' | 'selector',
    selector?: string,
    selectorType?: 'css' | 'xpath'
  ): SelectionResult {
    try {
      if (mode === 'inspect') {
        this.inspectionManager?.enterInspectionMode()
        this.isInspecting = true
        return { success: true, count: this.selectionCount }
      } else if (mode === 'selector' && selector) {
        let elements: NodeListOf<Element> | Element[]

        if (selectorType === 'xpath') {
          const result = document.evaluate(
            selector,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          )
          elements = []
          for (let i = 0; i < result.snapshotLength; i++) {
            const node = result.snapshotItem(i)
            if (node instanceof Element) {
              (elements as Element[]).push(node)
            }
          }
        } else {
          elements = document.querySelectorAll(selector)
        }

        elements.forEach((element) => {
          if (!this.selectionManager?.hasElement(element)) {
            this.selectionManager?.selectElement(element, (el) => findNearestComponent(el, this.verbose))
          }
        })

        this.selectionCount = this.selectionManager?.getSelectedCount() || 0
        return { success: true, count: elements.length }
      }

      return { success: false, count: 0, error: 'Invalid mode or missing selector' }
    } catch (error) {
      return {
        success: false,
        count: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async captureScreenshot(
    type: 'viewport' | 'element',
    selector?: string,
    quality: number = 0.7
  ): Promise<ScreenshotResult> {
    try {
      let targetElement: Element = document.body

      if (type === 'element' && selector) {
        const element = document.querySelector(selector)
        if (!element) {
          this.log(`Element not found for selector: ${selector}`)
          return { success: false, error: `Element not found: ${selector}` }
        }
        targetElement = element
      }

      this.log(`Capturing screenshot of ${type === 'element' ? selector : 'viewport'}`)
      const base64 = await this.captureElementBase64(targetElement, quality)
      return { success: true, base64 }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.log(`Screenshot error: ${errorMessage}`, error)
      return {
        success: false,
        error: errorMessage
      }
    }
  }

  // Renders one element to a base64 webp (no data-URL prefix). Throws on failure.
  private async captureElementBase64(targetElement: Element, quality: number = 0.7): Promise<string> {
    // Add timeout to prevent hanging on complex pages
    const screenshotPromise = toBlob(targetElement as HTMLElement, {
      quality,
      type: 'image/webp',
      cacheBust: true,
      pixelRatio: 1,
      includeQueryParams: true,
      // The canvas is sized to the border box; a cloned root margin would push
      // the content down and crop it (e.g. a <p> or <h1>)
      style: { margin: '0' },
      // Filter out all annotator UI elements
      filter: (node) => {
        if (node instanceof Element) {
          // Text-selection wrappers hold the user's highlighted page text, not UI
          if (node.classList.contains('annotator-text-selection')) return true

          const className = typeof node.className === 'string' ? node.className : ((node.className as unknown as SVGAnimatedString)?.baseVal || '')
          const tagName = node.tagName?.toLowerCase() || ''

          // Skip all annotator elements
          if (className.includes('annotator-') || tagName === 'annotator-toolbar') {
            return false
          }
        }
        return true
      },
    })

    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('Screenshot timeout')), SCREENSHOT_TIMEOUT_MS)
    )

    const blob = await Promise.race([screenshotPromise, timeoutPromise])

    if (!blob) {
      throw new Error('Failed to capture screenshot (toBlob returned null)')
    }

    this.log(`Screenshot captured, blob size: ${blob.size} bytes`)

    const reader = new FileReader()
    return new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  // Screenshots every selected element and stores each on the server, so the
  // feedback payload carries an `imagePath` per element. Sequential on purpose:
  // html-to-image clones the page per capture and parallel runs spike memory.
  // A failed capture leaves that element without an image instead of blocking
  // the feedback; the count of failures comes back so callers can say so.
  private async captureSelectionImages(): Promise<{ imagePaths: Map<Element, string>; failed: number }> {
    const imagePaths = new Map<Element, string>()
    let failed = 0
    if (!this.selectionManager) return { imagePaths, failed }

    for (const [element, info] of this.selectionManager.getSelectedElements()) {
      try {
        // Text selections are a wrapper span; the container shows the context
        const base64 = await this.captureElementBase64(info.textSelection?.containerElement ?? element)
        if (!this.rpc) throw new Error('Not connected')
        const filePath = await this.rpc.server.saveScreenshot(base64, SCREENSHOT_TIMEOUT_MS)
        if (isRpcError(filePath)) throw new Error(filePath.message)
        imagePaths.set(element, filePath)
      } catch (error) {
        failed++
        this.log(`Screenshot for selection #${info.index} failed:`, error)
      }
    }
    return { imagePaths, failed }
  }

  // Selected elements with a screenshot attached to each. Every feedback route
  // (Copy, Send to Claude, REST) reads through here. `selected` is the DOM side
  // of `elements`, read in the same tick, so a caller can drop exactly what it
  // sent even if the user selects more while it waits.
  private async collectFeedback(): Promise<{ elements: ElementData[]; selected: Element[]; failedImages: number }> {
    const { imagePaths, failed } = await this.captureSelectionImages()
    const selected = [...(this.selectionManager?.getSelectedElements().keys() ?? [])]
    return { elements: this.getSelectedElements(imagePaths), selected, failedImages: failed }
  }

  private deselectElements(elements: Element[]) {
    if (!this.selectionManager) return
    for (const element of elements) {
      this.selectionManager.deselectElement(element)
      this.elementComments.delete(element)
    }
    if (this.commentPopover.element && elements.includes(this.commentPopover.element)) this.hideCommentPopover()
    this.selectionCount = this.selectionManager.getSelectedCount()
    this.emitSelectionChanged()
  }

  private clearSelection() {
    this.selectionManager?.clearAllSelections()
    this.elementComments.clear()
    this.selectionCount = 0
    this.hideCommentPopover()
  }

  private injectCSS(css: string): InjectResult {
    try {
      const style = document.createElement('style')
      style.setAttribute('data-injected-by', 'ai-annotator')
      style.textContent = css
      document.head.appendChild(style)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private injectJS(code: string): InjectResult {
    try {
      // Execute code in page context using Function constructor (intentional for DevTools-like functionality)
      // eslint-disable-next-line no-new-func
      const fn = new Function(code)
      const result = fn()
      return { success: true, result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private getConsoleLogs(clear?: boolean): ConsoleEntry[] {
    const logs = [...this.consoleBuffer]
    if (clear) {
      this.consoleBuffer = []
    }
    return logs
  }

  // Called when clicking on an UNSELECTED element during inspection mode
  // (clicks on selected elements are handled by overlay → showCommentPopoverForElement)
  private handleElementSelected(element: Element) {
    if (!this.selectionManager) return

    // Skip if already selected (shouldn't happen, but safety check)
    if (this.selectionManager.hasElement(element)) return

    this.selectionManager.selectElement(element, (el) => findNearestComponent(el, this.verbose))
    this.showCommentPopoverForElement(element)

    this.selectionCount = this.selectionManager.getSelectedCount()
    this.emitSelectionChanged()
  }

  private handleTextSelected(range: Range, commonAncestor: Element) {
    if (!this.selectionManager) return

    // Step 1: Wrap text in a span
    const result = this.selectionManager.wrapTextRange(range, commonAncestor)

    if (!result) {
      // wrapTextRange returns null for cross-element selections or exceeding max length
      this.showToast('Select text within one element')
      return
    }

    try {
      // Step 2: Select the wrapper element (creates badge, overlay, etc.)
      this.selectionManager.selectElement(
        result.wrapper,
        (el: Element) => findNearestComponent(el, this.verbose),
        result.textSelection
      )

      // Step 3: Show popover and update UI
      this.showCommentPopoverForElement(result.wrapper)
      this.selectionCount = this.selectionManager.getSelectedCount()
      this.emitSelectionChanged()
    } catch (error) {
      // Clean up wrapper if selectElement fails
      result.wrapper.remove()
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.log('Text selection error:', message)
      this.showToast('Selection error')
    }
  }

  private removeSelectedElement() {
    if (!this.commentPopover.element) return
    this.deselectElements([this.commentPopover.element])
  }

  private showCommentPopoverForElement(element: Element) {
    if (this.popoverCleanup) {
      this.popoverCleanup()
      this.popoverCleanup = null
    }

    this.commentPopover = {
      visible: true,
      element,
      comment: this.elementComments.get(element) || ''
    }

    document.addEventListener('keydown', this.handlePopoverKeydown)
    if (this.clickListenerTimeout) {
      clearTimeout(this.clickListenerTimeout)
    }
    this.skipNextClickOutside = true
    this.clickListenerTimeout = setTimeout(() => {
      document.addEventListener('click', this.handleClickOutside, true)
      this.clickListenerTimeout = null
    }, 0)

    this.updateComplete.then(() => {
      const popoverEl = this.shadowRoot?.querySelector('.popover') as HTMLElement
      const textareaEl = this.shadowRoot?.querySelector('.popover-input') as HTMLTextAreaElement
      if (!popoverEl || !element) return

      if (textareaEl) {
        textareaEl.focus()
        this.autoResizeTextarea(textareaEl)
      }

      // Find the badge element for this specific selected element
      const badge = this.selectionManager?.getBadgeForElement(element)
      const referenceEl = badge || element

      this.popoverCleanup = autoUpdate(referenceEl, popoverEl, () => {
        computePosition(referenceEl, popoverEl, {
          strategy: 'fixed',
          placement: 'bottom-start',
          middleware: [
            offset(6),
            flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
            shift({ padding: 8 }),
          ],
        }).then(({ x, y }) => {
          Object.assign(popoverEl.style, {
            left: `${x}px`,
            top: `${y}px`,
          })
        })
      })

    })
  }


  private handlePopoverKeydown = (e: KeyboardEvent) => {
    if (!this.commentPopover.visible) return

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.hideCommentPopover()
    }
  }

  private handleClickOutside = (e: MouseEvent) => {
    if (!this.commentPopover.visible) return

    // Skip the click that triggered the popover (mouseup fires before click)
    if (this.skipNextClickOutside) {
      this.skipNextClickOutside = false
      return
    }

    const popoverEl = this.shadowRoot?.querySelector('.popover')
    if (!popoverEl) return

    // Check if click is inside popover
    const path = e.composedPath()
    if (path.includes(popoverEl)) return

    // Click is outside, close popover
    this.hideCommentPopover()
  }

  private handlePopoverInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      this.hideCommentPopover()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.hideCommentPopover()
    }
  }

  private hideCommentPopover() {
    // Clear pending click listener timeout to prevent race condition
    if (this.clickListenerTimeout) {
      clearTimeout(this.clickListenerTimeout)
      this.clickListenerTimeout = null
    }
    document.removeEventListener('keydown', this.handlePopoverKeydown)
    document.removeEventListener('click', this.handleClickOutside, true)
    if (this.popoverCleanup) {
      this.popoverCleanup()
      this.popoverCleanup = null
    }

    this.commentPopover = { visible: false, element: null, comment: '' }
  }

  private handlePopoverInput(e: Event) {
    const target = e.target as HTMLTextAreaElement
    const comment = target.value
    const element = this.commentPopover.element

    this.autoResizeTextarea(target)
    this.commentPopover = { ...this.commentPopover, comment }

    // Auto-save comment
    if (element) {
      if (comment.trim().length > 0) {
        this.elementComments.set(element, comment.trim())
      } else {
        this.elementComments.delete(element)
      }
    }
  }

  private shouldIgnoreElement(element: Element): boolean {
    // Check if element is inside annotator-toolbar (including shadow DOM)
    let current: Node | null = element
    while (current) {
      if (current instanceof Element) {
        if (current.tagName.toLowerCase() === 'annotator-toolbar') return true
        if (current.classList.contains('annotator-badge')) return true
        if (current.classList.contains('annotator-ignore')) return true
      }
      // Traverse up: if in shadow DOM, go to host; otherwise go to parent
      const parent: ParentNode | null = current.parentNode
      if (parent instanceof ShadowRoot) {
        current = parent.host
      } else {
        current = parent as Node | null
      }
    }
    return false
  }

  private cleanup() {
    if (this.popoverCleanup) {
      this.popoverCleanup()
      this.popoverCleanup = null
    }
    if (this.tooltipCleanup) {
      this.tooltipCleanup()
      this.tooltipCleanup = null
    }
    this.inspectionManager?.destroy()
    this.selectionManager?.clearAllSelections()
    this.restoreConsoleMethods()
    this.rpc?.dispose()
    this.socket?.disconnect()
  }

  private log(...args: unknown[]) {
    if (this.verbose) {
      console.log('[AI Annotator]', ...args)
    }
  }

  private emitSelectionChanged() {
    if (!this.socket?.connected) return
    this.socket.emit('selectionChanged', {
      count: this.selectionCount,
      elements: this.getSelectedElements(),
    })
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement, maxHeight = 120) {
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px'
  }

  private exitInspectingMode() {
    if (this.isInspecting) {
      this.inspectionManager?.exitInspectionMode()
      this.isInspecting = false
      if (this.commentPopover.visible) {
        this.hideCommentPopover()
      }
    }
  }

  private async copySelectedElements() {
    if (this.selectionCount === 0) {
      this.showToast('No elements selected')
      return
    }

    if (!this.sessionId) {
      this.showToast('No session ID')
      return
    }
    this.exitInspectingMode()
    this.showToast('Capturing screenshots…')

    // Keyboard shortcut behavior: always copy text to clipboard; additionally
    // push over the channel when a Claude listener is connected. Toast reflects
    // exactly which actions ran so the user is never told "Sent to Claude"
    // when no Claude was listening.
    const feedback = this.collectFeedback()
    let copied = true
    try {
      await this.writeClipboard(feedback.then(({ elements }) => this.buildFeedbackPrompt(elements)))
    } catch (error) {
      copied = false
      this.log('Clipboard copy failed:', error)
    }
    const { elements, failedImages } = await feedback

    const willSend = this.socket?.connected && this.channelListenerCount > 0
    if (willSend) {
      this.socket!.emit('feedback:submitted', { count: elements.length, elements })
    }

    // Clipboard failed. If we sent over the channel, that still happened —
    // tell the user the truth either way.
    const toast = willSend
      ? `Sent ${elements.length} element(s) to Claude`
      : copied ? `Copied ${elements.length} element(s)` : 'Failed to copy'
    this.showToast(toast + this.failedImagesNote(failedImages))
  }

  private toggleInspect() {
    if (this.isInspecting) {
      this.exitInspectingMode()
    } else {
      this.inspectionManager?.enterInspectionMode()
      this.isInspecting = true
    }
  }

  private handleClearClick() {
    this.exitInspectingMode()
    this.clearSelection()
    if (this.socket?.connected) {
      this.socket.emit('selectionChanged', {
        count: 0,
        elements: [],
      })
    }
  }

  // SVG Icons
  private renderCursorIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
    </svg>`
  }

  private renderTrashIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>`
  }

  private renderCloseIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>`
  }

  private renderHelpIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>`
  }

  private renderSendIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>`
  }

  private renderPaseoIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>`
  }

  private renderClipboardIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>`
  }

  private showToast(message: string) {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout)
    }
    this.toastMessage = message
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = ''
    }, 2000)
  }

  private showTooltip(text: string, reference: HTMLElement) {
    if (this.tooltipCleanup) {
      this.tooltipCleanup()
      this.tooltipCleanup = null
    }

    this.tooltip = { visible: true, text, x: 0, y: 0 }

    this.updateComplete.then(() => {
      const tooltipEl = this.shadowRoot?.querySelector('.tooltip') as HTMLElement
      if (!tooltipEl) return

      this.tooltipCleanup = autoUpdate(reference, tooltipEl, () => {
        computePosition(reference, tooltipEl, {
          strategy: 'fixed',
          placement: 'top',
          middleware: [
            offset(6),
            flip({ fallbackPlacements: ['bottom', 'left', 'right'] }),
            shift({ padding: 8 }),
          ],
        }).then(({ x, y }) => {
          Object.assign(tooltipEl.style, {
            left: `${x}px`,
            top: `${y}px`,
          })
        })
      })
    })
  }

  private hideTooltip() {
    if (this.tooltipCleanup) {
      this.tooltipCleanup()
      this.tooltipCleanup = null
    }
    this.tooltip = { visible: false, text: '', x: 0, y: 0 }
  }

  // Builds the paste-prompt text. The element data is inlined so a pasting
  // agent can act straight from the text — no REST/MCP round-trip to read it.
  // The endpoint still appears for the two things the paste can't carry:
  // clearing the selection afterwards, and fetching the opt-in fields.
  private buildFeedbackPrompt(elements: ElementData[]): string {
    const payload = filterFeedbackFields(
      elements as unknown as Record<string, unknown>[],
      CLIPBOARD_FIELDS
    )
    const endpoint = `${this.wsEndpoint}/api/sessions/${this.sessionId}/feedback`
    return [
      `I selected ${elements.length} element(s) in the browser (page: ${window.location.href}) and left feedback on them.`,
      `The full element data is inlined below — you do not need to call the API to read it.`,
      '',
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
      '',
      `For each item: open the "file:line" path in \`componentData.componentLocation\` and apply the change its \`comment\` asks for.`,
      `\`selectedText\`, when present, is the exact text the user highlighted.`,
      `Open every \`imagePath\` before changing anything: each is a screenshot of the element as the user sees it. Items without a \`comment\` are context the user pointed at for the commented ones.`,
      `After the change ships, clear the selection: DELETE ${endpoint}`,
      `For computed styles or child elements: GET ${endpoint}?fields=styles,children`,
    ].join('\n')
  }

  private async copyFeedbackToClipboard() {
    this.exitInspectingMode()
    if (this.demo) {
      this.showToast('Demo mode — no server')
      return
    }
    if (!this.sessionId) {
      this.showToast('No session ID')
      return
    }
    if (this.selectionCount === 0) {
      this.showToast('No elements selected')
      return
    }
    this.showToast('Capturing screenshots…')
    const feedback = this.collectFeedback()
    try {
      await this.writeClipboard(feedback.then(({ elements }) => this.buildFeedbackPrompt(elements)))
      const { elements, failedImages } = await feedback
      this.showToast(`Copied ${elements.length} element(s)` + this.failedImagesNote(failedImages))
      this.log('Copied to clipboard:', elements)
    } catch (error) {
      this.showToast('Failed to copy')
      this.log('Failed to copy:', error)
    }
  }

  private async sendFeedbackToClaude() {
    this.exitInspectingMode()
    if (this.demo) {
      this.showToast('Demo mode — no server')
      return
    }
    if (!this.sessionId) {
      this.showToast('No session ID')
      return
    }
    if (!this.socket?.connected) {
      this.showToast('Not connected')
      return
    }
    if (this.channelListenerCount === 0) {
      // Defensive: the button is only rendered while a listener is connected, but never trust UI.
      this.showToast('No Claude listening')
      return
    }
    // Fires regardless of selection state. When something is selected the data
    // rides along, so Claude reads it from the push; with an empty selection
    // the channel tells Claude to check REST instead.
    if (this.selectionCount > 0) this.showToast('Capturing screenshots…')
    const { elements, failedImages } = await this.collectFeedback()
    if (!this.socket?.connected) {
      this.showToast('Not connected')
      return
    }
    this.socket.emit('feedback:submitted', { count: elements.length, elements })
    this.showToast(
      (elements.length ? `Sent ${elements.length} element(s) to Claude` : 'Sent to Claude') +
      this.failedImagesNote(failedImages)
    )
  }

  private async sendFeedbackToPaseo() {
    this.exitInspectingMode()
    if (this.demo) {
      this.showToast('Demo mode — no server')
      return
    }
    if (!this.sessionId) {
      this.showToast('No session ID')
      return
    }
    if (!this.socket?.connected) {
      this.showToast('Not connected')
      return
    }
    if (this.selectionCount === 0) {
      this.showToast('No elements selected')
      return
    }
    if (this.paseoSending) return
    this.paseoSending = true
    try {
      this.showToast('Capturing screenshots…')
      const { elements, selected, failedImages } = await this.collectFeedback()
      if (!this.socket?.connected) {
        this.showToast('Not connected')
        return
      }
      const result = await this.socket
        .timeout(35000)
        .emitWithAck('paseo:send', { elements })
        .catch(() => ({ ok: false, error: 'Paseo did not respond' }))
      // The agent owns these now; leaving them selected would send them again
      // with the next selection. A failed send keeps them for a retry.
      if (result.ok) this.deselectElements(selected)
      this.showToast(
        (result.ok ? `Started a Paseo agent for ${elements.length} element(s)` : `Paseo: ${result.error ?? 'send failed'}`) +
        this.failedImagesNote(failedImages)
      )
    } finally {
      this.paseoSending = false
    }
  }

  // Starts the clipboard write synchronously, inside the user gesture, and lets
  // the text resolve later. Screenshots take seconds, and Safari/Firefox reject
  // a writeText() issued after the gesture has expired.
  private writeClipboard(text: Promise<string>): Promise<void> {
    return navigator.clipboard.write([
      new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) }),
    ])
  }

  private failedImagesNote(failed: number): string {
    return failed ? ` (${failed} screenshot(s) failed)` : ''
  }

  private renderGripIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 18" fill="currentColor">
      <circle cx="3.5" cy="3" r="1.5" /><circle cx="8.5" cy="3" r="1.5" />
      <circle cx="3.5" cy="9" r="1.5" /><circle cx="8.5" cy="9" r="1.5" />
      <circle cx="3.5" cy="15" r="1.5" /><circle cx="8.5" cy="15" r="1.5" />
    </svg>`
  }

  private renderChevronIcon(direction: 'left' | 'right') {
    const d = direction === 'left' ? 'M15.75 19.5L8.25 12l7.5-7.5' : 'M8.25 4.5l7.5 7.5-7.5 7.5'
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="${d}" />
    </svg>`
  }

  private renderToast() {
    if (!this.toastMessage) return ''
    const classes = `toast ${this.layout.side === 'left' ? 'toast-left' : ''} ${this.toastBelow ? 'toast-below' : ''}`
    return html`<div class="${classes}" role="status" aria-live="polite">${this.toastMessage}</div>`
  }

  private renderCollapsed() {
    const { side } = this.layout
    // Chevron points away from the edge: the direction the toolbar opens.
    const opens = side === 'left' ? 'right' : 'left'
    return html`
      <button
        class="dock-tab ${side}"
        @pointerdown=${(e: PointerEvent) => this.startDrag(e, () => this.toggleCollapsed())}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' ? this.toggleCollapsed() : undefined}
        aria-label="Expand AI Annotator toolbar"
        title="Expand (drag to move)"
      >
        ${this.renderChevronIcon(opens)}
        ${this.selectionCount > 0 ? html`<span class="badge" aria-label="${this.selectionCount} selections">${this.selectionCount}</span>` : ''}
        ${this.renderToast()}
      </button>
    `
  }

  private renderErrorIcon() {
    return html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>`
  }

  private openHelpPage() {
    this.exitInspectingMode()
    window.open('https://annotator.aiocean.io/', '_blank')
  }

  render() {
    if (!this.connected) {
      return html`
        <div class="toolbar" role="alert" aria-live="polite">
          <div class="error-message">
            ${this.renderErrorIcon()}
            <span>Cannot connect to AI Annotator server</span>
          </div>
        </div>
      `
    }

    return html`
      ${this.layout.collapsed ? this.renderCollapsed() : this.renderExpanded()}
      ${this.tooltip.visible ? html`<div class="tooltip" role="tooltip">${this.tooltip.text}</div>` : ''}
      ${this.renderCommentPopover()}
    `
  }

  private renderExpanded() {
    return html`
      <div class="toolbar" role="toolbar" aria-label="AI Annotator tools">
        <div
          class="drag-handle"
          @pointerdown=${(e: PointerEvent) => this.startDrag(e)}
          aria-label="Drag to move toolbar"
          title="Drag to move"
        >
          ${this.renderGripIcon()}
        </div>

        <button
          class="toolbar-btn ${this.isInspecting ? 'active' : ''}"
          @click=${this.toggleInspect}
          @mouseenter=${(e: MouseEvent) => this.showTooltip(this.isInspecting ? 'Press ESC to exit' : 'Inspect elements', e.currentTarget as HTMLElement)}
          @mouseleave=${() => this.hideTooltip()}
          aria-label="${this.isInspecting ? 'Exit inspection mode' : 'Inspect elements'}"
          aria-pressed="${this.isInspecting}"
          title="${this.isInspecting ? 'Press ESC to exit' : 'Inspect elements'}"
        >
          ${this.renderCursorIcon()}
        </button>

        ${this.selectionCount > 0 ? html`
          <div class="btn-with-badge">
            <button
              class="toolbar-btn"
              @click=${this.handleClearClick}
              @mouseenter=${(e: MouseEvent) => this.showTooltip('Clear selections', e.currentTarget as HTMLElement)}
              @mouseleave=${() => this.hideTooltip()}
              aria-label="Clear all selections"
              title="Clear selections"
            >
              ${this.renderTrashIcon()}
            </button>
            <span class="badge" aria-label="${this.selectionCount} selections">${this.selectionCount}</span>
          </div>
        ` : ''}

        ${this.selectionCount > 0 ? html`<div class="divider" role="separator" aria-orientation="vertical"></div>` : ''}

        ${this.selectionCount > 0 ? html`
          <button
            class="toolbar-btn"
            @click=${this.copyFeedbackToClipboard}
            @mouseenter=${(e: MouseEvent) => this.showTooltip('Copy prompt for Claude', e.currentTarget as HTMLElement)}
            @mouseleave=${() => this.hideTooltip()}
            aria-label="Copy feedback prompt to clipboard"
            title="Copy"
          >
            ${this.renderClipboardIcon()}
          </button>
        ` : ''}

        ${this.selectionCount > 0 && this.channelListenerCount > 0 ? html`
          <button
            class="toolbar-btn"
            @click=${this.sendFeedbackToClaude}
            @mouseenter=${(e: MouseEvent) => this.showTooltip('Send to Claude', e.currentTarget as HTMLElement)}
            @mouseleave=${() => this.hideTooltip()}
            aria-label="Send selections to Claude Code"
            title="Send to Claude"
          >
            ${this.renderSendIcon()}
          </button>
        ` : ''}

        ${this.paseoConfigured && this.selectionCount > 0 ? html`
          <button
            class="toolbar-btn"
            @click=${this.sendFeedbackToPaseo}
            ?disabled=${this.paseoSending}
            aria-busy=${this.paseoSending ? 'true' : 'false'}
            @mouseenter=${(e: MouseEvent) => this.showTooltip(this.paseoSending ? 'Sending to Paseo…' : 'Send to Paseo', e.currentTarget as HTMLElement)}
            @mouseleave=${() => this.hideTooltip()}
            aria-label="Send selections to Paseo agent"
            title="Send to Paseo"
          >
            ${this.renderPaseoIcon()}
          </button>
        ` : ''}

        <button
          class="toolbar-btn"
          @click=${this.openHelpPage}
          @mouseenter=${(e: MouseEvent) => this.showTooltip('Help', e.currentTarget as HTMLElement)}
          @mouseleave=${() => this.hideTooltip()}
          aria-label="Open help documentation"
          title="Help"
        >
          ${this.renderHelpIcon()}
        </button>

        <button
          class="toolbar-btn"
          @click=${this.toggleCollapsed}
          @mouseenter=${(e: MouseEvent) => this.showTooltip('Tuck into screen edge', e.currentTarget as HTMLElement)}
          @mouseleave=${() => this.hideTooltip()}
          aria-label="Collapse toolbar"
          title="Collapse"
        >
          ${this.renderChevronIcon(this.layout.side)}
        </button>

        ${this.renderToast()}
      </div>
    `
  }

  private renderCommentPopover() {
    return html`
      ${this.commentPopover.visible ? html`
        <div class="popover" role="dialog" aria-label="Element comment" aria-modal="false">
          <textarea
            class="popover-input"
            placeholder="Add a note... (↵ to close)"
            .value=${this.commentPopover.comment}
            @input=${this.handlePopoverInput}
            @keydown=${this.handlePopoverInputKeydown}
            rows="1"
            aria-label="Add a comment for the selected element"
          ></textarea>
          <div class="popover-actions" role="group" aria-label="Comment actions">
            <button class="popover-btn danger" @click=${this.removeSelectedElement} title="Remove selection" aria-label="Remove this selection">
              ${this.renderTrashIcon()}
            </button>
            <button class="popover-btn" @click=${this.hideCommentPopover} title="Close (Esc)" aria-label="Close comment">
              ${this.renderCloseIcon()}
            </button>
          </div>
        </div>
      ` : ''}
    `
  }
}

// Guard against double registration when script is loaded multiple times
if (!customElements.get('annotator-toolbar')) {
  customElements.define('annotator-toolbar', AnnotatorToolbar)
}

declare global {
  interface HTMLElementTagNameMap {
    'annotator-toolbar': AnnotatorToolbar
  }
}
