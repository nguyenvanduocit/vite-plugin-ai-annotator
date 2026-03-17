/**
 * Shared MCP tool definitions for AI Annotator
 *
 * Registers all 9 MCP tools on a McpServer instance.
 * Used by both ws-server.ts (HTTP MCP) and mcp-stdio.ts (stdio MCP).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type {
  BrowserSession,
  PageContext,
  ElementData,
  SelectionResult,
  ScreenshotResult,
  InjectResult,
  ConsoleEntry,
} from './rpc/define'
import type { RpcError } from './rpc/types.generated'
import { saveScreenshot, filterFeedbackFields } from './utils/screenshot'

export interface AnnotatorConnection {
  sessionId: string
  getPageContext(timeout?: number): Promise<PageContext | RpcError>
  getSelectedElements(timeout?: number): Promise<ElementData[] | RpcError>
  triggerSelection(mode: 'inspect' | 'selector', selector?: string, selectorType?: 'css' | 'xpath', timeout?: number): Promise<SelectionResult | RpcError>
  captureScreenshot(type: 'viewport' | 'element', selector?: string, quality?: number, timeout?: number): Promise<ScreenshotResult | RpcError>
  clearSelection(): void
  injectCSS(css: string, timeout?: number): Promise<InjectResult | RpcError>
  injectJS(code: string, timeout?: number): Promise<InjectResult | RpcError>
  getConsole(clear?: boolean, timeout?: number): Promise<ConsoleEntry[] | RpcError>
}

export type GetConnection = (sessionId?: string) => AnnotatorConnection | { error: string }
export type ListSessions = () => Promise<BrowserSession[]>

function isError(value: unknown): value is RpcError {
  return !!value && typeof value === 'object' && 'message' in value && 'code' in value
}

// Helper to create text response
function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

export function registerMcpTools(mcp: McpServer, listSessions: ListSessions, getConnection: GetConnection): void {
  // Common session param for all browser-interacting tools
  const sessionIdParam = z.string().optional().describe('Browser session ID (optional if only one session)')

  // Tool: annotator_list_sessions
  mcp.tool(
    'annotator_list_sessions',
    'List all connected browser sessions',
    {},
    async () => {
      const sessionList = await listSessions()
      return textResponse(
        sessionList.length > 0
          ? JSON.stringify(sessionList, null, 2)
          : 'No browser sessions connected. Add the annotator script to your webpage.'
      )
    }
  )

  // Tool: annotator_get_page_context
  mcp.tool(
    'annotator_get_page_context',
    'Get current page context from browser session (URL, title, selection count)',
    { sessionId: sessionIdParam },
    async ({ sessionId }) => {
      const conn = getConnection(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.getPageContext(10000)
      if (isError(result)) return textResponse(`Error: ${result.message}`)

      return textResponse(JSON.stringify(result, null, 2))
    }
  )

  // Tool: annotator_select_feedback
  mcp.tool(
    'annotator_select_feedback',
    'Enter feedback inspection mode or select feedback by CSS/XPath selector. Use this to let users mark UI elements they want to provide feedback on.',
    {
      sessionId: sessionIdParam,
      mode: z.enum(['inspect', 'selector']).default('inspect').describe('Feedback selection mode'),
      selector: z.string().optional().describe('CSS or XPath selector (required when mode is "selector")'),
      selectorType: z.enum(['css', 'xpath']).default('css').describe('Type of selector'),
    },
    async ({ sessionId, mode, selector, selectorType }) => {
      const conn = getConnection(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.triggerSelection(mode, selector, selectorType, 10000)
      if (isError(result)) return textResponse(`Error: ${result.message}`)

      return textResponse(
        result.success
          ? `Feedback selection triggered. ${result.count} feedback item(s) selected.`
          : `Feedback selection failed: ${result.error}`
      )
    }
  )

  // Tool: annotator_get_feedback
  const feedbackFieldsEnum = z.enum(['xpath', 'attributes', 'styles', 'children'])
  mcp.tool(
    'annotator_get_feedback',
    'Get data about currently selected feedback items in the browser. Returns details of UI elements the user has marked for feedback.',
    {
      sessionId: sessionIdParam,
      fields: z.array(feedbackFieldsEnum).optional().describe(
        'Additional fields to include: xpath, attributes, styles (computedStyles), children. By default returns basic fields (index, tagName, cssSelector, textContent), comment, and componentData.'
      ),
    },
    async ({ sessionId, fields }) => {
      const conn = getConnection(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.getSelectedElements(15000)
      if (isError(result)) return textResponse(`Error: ${result.message}`)

      if (result.length === 0) {
        return textResponse('No feedback selected. Use annotator_select_feedback first.')
      }

      const filtered = filterFeedbackFields(result as unknown as Record<string, unknown>[], fields)
      return textResponse(JSON.stringify(filtered, null, 2))
    }
  )

  // Tool: annotator_capture_screenshot
  mcp.tool(
    'annotator_capture_screenshot',
    'Capture a screenshot (webp) of the viewport or a specific element. Returns the file path where the screenshot is saved.',
    {
      sessionId: sessionIdParam,
      type: z.enum(['viewport', 'element']).default('viewport').describe('Type of screenshot'),
      selector: z.string().optional().describe('CSS selector for element screenshot'),
      quality: z.number().min(0).max(1).default(0.7).describe('Image quality (0-1)'),
    },
    async ({ sessionId, type, selector, quality }) => {
      const conn = getConnection(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.captureScreenshot(type, selector, quality, 30000)
      if (isError(result)) return textResponse(`Error: ${result.message}`)

      if (result.success && result.base64) {
        const filePath = saveScreenshot(result.base64)
        return textResponse(filePath)
      }
      return textResponse(`Screenshot failed: ${result.error}`)
    }
  )

  // Tool: annotator_clear_feedback
  mcp.tool(
    'annotator_clear_feedback',
    'Clear all selected feedback items in the browser. Removes all UI element selections made for feedback.',
    { sessionId: sessionIdParam },
    async ({ sessionId }) => {
      const conn = getConnection(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      conn.clearSelection()
      return textResponse('Feedback cleared.')
    }
  )

  // Tool: annotator_inject_css
  mcp.tool(
    'annotator_inject_css',
    'Inject CSS styles into the page',
    {
      sessionId: sessionIdParam,
      css: z.string().describe('CSS code to inject into the page'),
    },
    async ({ sessionId, css }) => {
      const conn = getConnection(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.injectCSS(css, 10000)
      if (isError(result)) return textResponse(`Error: ${result.message}`)

      return textResponse(
        result.success ? 'CSS injected successfully.' : `CSS injection failed: ${result.error}`
      )
    }
  )

  // Tool: annotator_inject_js
  mcp.tool(
    'annotator_inject_js',
    'Inject and execute JavaScript code in the page context',
    {
      sessionId: sessionIdParam,
      code: z.string().describe('JavaScript code to execute in the page'),
    },
    async ({ sessionId, code }) => {
      const conn = getConnection(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.injectJS(code, 15000)
      if (isError(result)) return textResponse(`Error: ${result.message}`)

      if (result.success) {
        return textResponse(
          result.result !== undefined
            ? `Result: ${JSON.stringify(result.result, null, 2)}`
            : 'JavaScript executed successfully (no return value).'
        )
      }
      return textResponse(`JavaScript execution failed: ${result.error}`)
    }
  )

  // Tool: annotator_get_console
  mcp.tool(
    'annotator_get_console',
    'Get console logs captured from the browser',
    {
      sessionId: sessionIdParam,
      clear: z.boolean().default(false).describe('Clear the console buffer after reading'),
    },
    async ({ sessionId, clear }) => {
      const conn = getConnection(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.getConsole(clear, 15000)
      if (isError(result)) return textResponse(`Error: ${result.message}`)

      return textResponse(
        result.length > 0 ? JSON.stringify(result, null, 2) : 'No console logs captured.'
      )
    }
  )
}
