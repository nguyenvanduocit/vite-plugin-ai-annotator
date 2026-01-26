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
import { customElement, property, state } from 'lit/decorators.js'
import { io, Socket } from 'socket.io-client'
import { toBlob } from 'html-to-image'
import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom'

import { createElementSelectionManager, type ElementSelectionManager, type SelectedElementInfo } from './annotator/selection'
import { createInspectionManager, type InspectionManager } from './annotator/inspection'
import { findNearestComponent } from './annotator/detectors'
import type { ElementData, PageContext, SelectionResult, ScreenshotResult, ConsoleEntry, InjectResult } from './rpc/define'
import { createRpcClient, type RpcClient } from './rpc/client.generated'

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

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

@customElement('annotator-toolbar')
export class AnnotatorToolbar extends LitElement {
  @property({ attribute: 'ws-endpoint' }) wsEndpoint = 'http://localhost:7318'
  @property({ attribute: 'verbose', type: Boolean }) verbose = false

  @state() private connected = false
  @state() private sessionId = ''
  @state() private selectionCount = 0
  @state() private isInspecting = false
  @state() private commentPopover: PopoverState = { visible: false, element: null, comment: '' }
  @state() private tooltip: TooltipState = { visible: false, text: '', x: 0, y: 0 }
  @state() private toastMessage = ''
  private popoverCleanup: (() => void) | null = null
  private tooltipCleanup: (() => void) | null = null
  private toastTimeout: ReturnType<typeof setTimeout> | null = null

  private socket: Socket | null = null
  private rpc: RpcClient | null = null
  private selectionManager: ElementSelectionManager | null = null
  private inspectionManager: InspectionManager | null = null
  private elementComments = new Map<Element, string>()
  private consoleBuffer: ConsoleEntry[] = []
  private originalConsoleMethods: Partial<Record<keyof Console, (...args: unknown[]) => void>> = {}

  static styles = css`
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');

    :host {
      --cyber-pink: #FF00FF;
      --cyber-cyan: #00FFFF;
      --cyber-yellow: #FFFF00;
      --cyber-black: #050505;
      --cyber-gray: #121212;

      position: fixed;
      bottom: 16px;
      right: 16px;
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

    .toolbar-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
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

    .popover::before {
      content: '// COMMENT_INPUT';
      position: absolute;
      top: -20px;
      left: -2px;
      padding: 2px 6px;
      font-size: 9px;
      color: var(--cyber-cyan);
      background: var(--cyber-black);
      border: 1px solid var(--cyber-cyan);
      text-transform: uppercase;
      letter-spacing: 1px;
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
    this.initializeManagers()
    this.initializeConsoleCapture()
    this.connectToServer()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.cleanup()
  }

  private initializeManagers() {
    this.selectionManager = createElementSelectionManager()

    // Set up edit callback for badge pencil icon click
    this.selectionManager.setOnEditClick((element) => {
      this.showCommentPopoverForElement(element)
    })

    this.inspectionManager = createInspectionManager({
      onElementSelect: (element) => this.handleElementSelected(element),
      onMultiSelect: (elements) => this.handleMultiSelect(elements),
      shouldIgnoreElement: (element) => this.shouldIgnoreElement(element),
      isElementSelected: (element) => this.selectionManager?.hasElement(element) || false,
      onEscape: () => this.exitInspectingMode(),
      onCopy: () => this.copySelectedElements(),
    })
  }

  private initializeConsoleCapture() {
    CONSOLE_METHODS.forEach((method) => {
      this.originalConsoleMethods[method] = console[method].bind(console)

      console[method] = (...args: unknown[]) => {
        // Store in buffer with size limit per entry
        const MAX_ARG_LENGTH = 10000
        this.consoleBuffer.push({
          type: method,
          args: args.map(arg => {
            try {
              const str = typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
              return str.length > MAX_ARG_LENGTH ? str.slice(0, MAX_ARG_LENGTH) + '...[truncated]' : str
            } catch {
              return '[circular or unserializable]'
            }
          }),
          timestamp: Date.now()
        })

        // Limit buffer size to prevent memory issues
        if (this.consoleBuffer.length > 1000) {
          this.consoleBuffer = this.consoleBuffer.slice(-500)
        }

        // Call original method
        this.originalConsoleMethods[method]?.(...args)
      }
    })
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
  }

  private registerRpcHandlers() {
    if (!this.rpc) return

    this.rpc.handle.getPageContext(async () => this.getPageContext())
    this.rpc.handle.getSelectedElements(async () => this.getSelectedElements())
    this.rpc.handle.triggerSelection(async (mode, selector, selectorType) =>
      this.triggerSelection(mode, selector, selectorType)
    )
    this.rpc.handle.captureScreenshot(async (type, selector, quality) =>
      this.captureScreenshot(type, selector, quality)
    )
    this.rpc.handle.clearSelection(async () => this.clearSelection())
    this.rpc.handle.ping(async () => 'pong')
    this.rpc.handle.injectCSS(async (css) => this.injectCSS(css))
    this.rpc.handle.injectJS(async (code) => this.injectJS(code))
    this.rpc.handle.getConsole(async (clear) => this.getConsoleLogs(clear))
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

  private getSelectedElements(): ElementData[] {
    if (!this.selectionManager) return []

    const elements = this.selectionManager.buildHierarchicalStructure(
      (el) => findNearestComponent(el, this.verbose)
    )

    // Add comments to elements
    const addComments = (items: ElementData[], selectedElements: Map<Element, SelectedElementInfo>) => {
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
          addComments(item.children, selectedElements)
        }
      }
    }

    addComments(elements, this.selectionManager.getSelectedElements())
    return elements
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

      const blob = await toBlob(targetElement as HTMLElement, {
        quality,
        type: 'image/webp',
        cacheBust: true,
        skipFonts: true,
      })

      if (!blob) {
        this.log('toBlob returned null - screenshot capture failed')
        return { success: false, error: 'Failed to capture screenshot (toBlob returned null)' }
      }

      this.log(`Screenshot captured, blob size: ${blob.size} bytes`)

      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string
          const base64Data = result.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

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

    // Select the element and show popover
    this.selectionManager.selectElement(element, (el) => findNearestComponent(el, this.verbose))
    this.showCommentPopoverForElement(element)

    this.selectionCount = this.selectionManager.getSelectedCount()

    if (this.socket?.connected) {
      this.socket.emit('selectionChanged', {
        count: this.selectionCount,
        elements: this.getSelectedElements(),
      })
    }
  }

  private handleMultiSelect(elements: Element[]) {
    if (!this.selectionManager) return

    let newSelectCount = 0
    for (const element of elements) {
      if (!this.selectionManager.hasElement(element)) {
        this.selectionManager.selectElement(element, (el) => findNearestComponent(el, this.verbose))
        newSelectCount++
      }
    }

    this.selectionCount = this.selectionManager.getSelectedCount()

    if (newSelectCount > 0) {
      this.showToast(`Selected ${newSelectCount} element(s)`)
    }

    if (this.socket?.connected) {
      this.socket.emit('selectionChanged', {
        count: this.selectionCount,
        elements: this.getSelectedElements(),
      })
    }
  }

  private removeSelectedElement() {
    if (!this.commentPopover.element || !this.selectionManager) return

    const element = this.commentPopover.element
    this.selectionManager.deselectElement(element)
    this.elementComments.delete(element)
    this.hideCommentPopover()

    this.selectionCount = this.selectionManager.getSelectedCount()

    if (this.socket?.connected) {
      this.socket.emit('selectionChanged', {
        count: this.selectionCount,
        elements: this.getSelectedElements(),
      })
    }
  }

  private showCommentPopoverForElement(element: Element) {
    // Clean up previous popover positioning
    if (this.popoverCleanup) {
      this.popoverCleanup()
      this.popoverCleanup = null
    }

    const existingComment = this.elementComments.get(element) || ''

    this.commentPopover = {
      visible: true,
      element,
      comment: existingComment
    }

    // Add keyboard listener for ESC and Enter
    document.addEventListener('keydown', this.handlePopoverKeydown)

    // Setup floating-ui positioning after render
    this.updateComplete.then(() => {
      const popoverEl = this.shadowRoot?.querySelector('.popover') as HTMLElement
      const textareaEl = this.shadowRoot?.querySelector('.popover-input') as HTMLTextAreaElement
      if (!popoverEl || !element) return

      // Auto-focus and auto-resize textarea
      if (textareaEl) {
        textareaEl.focus()
        textareaEl.style.height = 'auto'
        textareaEl.style.height = Math.min(textareaEl.scrollHeight, 37) + 'px'
      }

      this.popoverCleanup = autoUpdate(element, popoverEl, () => {
        computePosition(element, popoverEl, {
          strategy: 'fixed',
          placement: 'bottom-start',
          middleware: [
            offset(8),
            flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end', 'right', 'left'] }),
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
    document.removeEventListener('keydown', this.handlePopoverKeydown)
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

    // Auto-resize textarea
    target.style.height = 'auto'
    target.style.height = Math.min(target.scrollHeight, 120) + 'px'

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
    const elements = this.getSelectedElements()
    if (elements.length === 0) {
      this.showToast('No elements selected')
      return
    }

    const text = `I have selected ${elements.length} feedback item(s) in the browser. Use the \`annotator_get_feedback\` tool to retrieve them and modify the code.`
    try {
      await navigator.clipboard.writeText(text)
      this.showToast(`Copied ${elements.length} element(s)`)
    } catch (error) {
      this.showToast('Failed to copy')
      this.log('Failed to copy:', error)
    }
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

  private async copySessionId() {
    this.exitInspectingMode()
    if (!this.sessionId) {
      this.showToast('No session ID')
      return
    }
    const text = `I have feedback in the browser (session: ${this.sessionId}). Use the \`annotator_get_feedback\` tool to retrieve them.`
    try {
      await navigator.clipboard.writeText(text)
      this.showToast('Copied!')
      this.log('Copied to clipboard:', text)
    } catch (error) {
      this.showToast('Failed to copy')
      this.log('Failed to copy:', error)
    }
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
        <div class="toolbar">
          <div class="error-message">
            ${this.renderErrorIcon()}
            <span>Cannot connect to AI Annotator server</span>
          </div>
        </div>
      `
    }

    return html`
      <div class="toolbar">
        <button
          class="toolbar-btn ${this.isInspecting ? 'active' : ''}"
          @click=${this.toggleInspect}
          @mouseenter=${(e: MouseEvent) => this.showTooltip(this.isInspecting ? 'Press ESC to exit' : 'Inspect elements', e.currentTarget as HTMLElement)}
          @mouseleave=${() => this.hideTooltip()}
        >
          ${this.renderCursorIcon()}
        </button>

        <div class="btn-with-badge">
          <button
            class="toolbar-btn"
            @click=${this.handleClearClick}
            @mouseenter=${(e: MouseEvent) => this.showTooltip('Clear selections', e.currentTarget as HTMLElement)}
            @mouseleave=${() => this.hideTooltip()}
            ?disabled=${this.selectionCount === 0}
          >
            ${this.renderTrashIcon()}
          </button>
          ${this.selectionCount > 0 ? html`<span class="badge">${this.selectionCount}</span>` : ''}
        </div>

        <div class="divider"></div>

        <button
          class="toolbar-btn"
          @click=${this.copySessionId}
          @mouseenter=${(e: MouseEvent) => this.showTooltip('Copy session', e.currentTarget as HTMLElement)}
          @mouseleave=${() => this.hideTooltip()}
        >
          ${this.renderClipboardIcon()}
        </button>

        <button
          class="toolbar-btn"
          @click=${this.openHelpPage}
          @mouseenter=${(e: MouseEvent) => this.showTooltip('Help', e.currentTarget as HTMLElement)}
          @mouseleave=${() => this.hideTooltip()}
        >
          ${this.renderHelpIcon()}
        </button>

        ${this.toastMessage ? html`<div class="toast">${this.toastMessage}</div>` : ''}
      </div>

      ${this.tooltip.visible ? html`<div class="tooltip">${this.tooltip.text}</div>` : ''}

      ${this.commentPopover.visible ? html`
        <div class="popover">
          <textarea
            class="popover-input"
            placeholder="Add a note... (↵ to close)"
            .value=${this.commentPopover.comment}
            @input=${this.handlePopoverInput}
            @keydown=${this.handlePopoverInputKeydown}
            rows="1"
          ></textarea>
          <div class="popover-actions">
            <button class="popover-btn danger" @click=${this.removeSelectedElement} title="Remove selection">
              ${this.renderTrashIcon()}
            </button>
            <button class="popover-btn" @click=${this.hideCommentPopover} title="Close (Esc)">
              ${this.renderCloseIcon()}
            </button>
          </div>
        </div>
      ` : ''}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'annotator-toolbar': AnnotatorToolbar
  }
}
