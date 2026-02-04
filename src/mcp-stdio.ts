#!/usr/bin/env node
/**
 * AI Annotator MCP CLI
 *
 * Stdio-based MCP server that connects to AI Annotator server via socket.io
 * and forwards tool calls to browser sessions.
 *
 * Usage:
 *   node mcp-stdio.js [--server <url>]
 *
 * Options:
 *   --server, -s   Server URL (default: http://localhost:7318)
 *                  Can also use AI_ANNOTATOR_SERVER env var
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { io, Socket } from 'socket.io-client'
import { z } from 'zod'
import type { BrowserSession } from './rpc/define'
import { saveScreenshot, filterFeedbackFields } from './utils/screenshot'

interface McpToolResponse {
  success: boolean
  data?: unknown
  error?: string
}

// Parse CLI arguments
function parseArgs(): { serverUrl: string } {
  const args = process.argv.slice(2)
  let serverUrl: string | undefined = process.env.AI_ANNOTATOR_SERVER

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if ((arg === '--server' || arg === '-s') && args[i + 1]) {
      serverUrl = args[i + 1]
      i++
    }
  }

  if (!serverUrl) {
    console.error('Error: --server <url> is required')
    console.error('')
    console.error('Usage: vite-plugin-ai-annotator mcp --server <url>')
    console.error('')
    console.error('Example:')
    console.error('  vite-plugin-ai-annotator mcp --server http://localhost:7318')
    process.exit(1)
  }

  return { serverUrl }
}


// Reconnection state
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 20
const RECONNECT_DELAY_MS = 10000
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pendingReconnect: (() => void) | null = null

// Trigger immediate reconnect if waiting
function triggerImmediateReconnect(): void {
  if (reconnectTimer && pendingReconnect) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    pendingReconnect()
    pendingReconnect = null
  }
}

// Create socket connection to server
function createServerConnection(serverUrl: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(serverUrl, {
      transports: ['websocket'],
      reconnection: false, // We handle reconnection manually
      query: { clientType: 'mcp' }
    })

    const timeout = setTimeout(() => {
      socket.disconnect()
      reject(new Error(`Connection timeout to ${serverUrl}`))
    }, 10000)

    socket.on('connect', () => {
      clearTimeout(timeout)
      reconnectAttempts = 0 // Reset on successful connect
      resolve(socket)
    })

    socket.on('connect_error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to connect: ${err.message}`))
    })
  })
}

// Reconnect with retry logic
async function reconnectWithRetry(serverUrl: string, onReconnect: (socket: Socket) => void): Promise<void> {
  while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++
    console.error(`Reconnecting to server... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)

    try {
      const newSocket = await createServerConnection(serverUrl)
      console.error('Reconnected to server successfully')
      onReconnect(newSocket)
      return
    } catch {
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('Max reconnection attempts reached. Exiting.')
        process.exit(1)
      }

      // Wait with interruptible delay
      await new Promise<void>((resolve) => {
        pendingReconnect = resolve
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          pendingReconnect = null
          resolve()
        }, RECONNECT_DELAY_MS)
      })
    }
  }
}

// Call server method with timeout
function callServer<T>(socket: Socket, event: string, args: unknown[] = [], timeout = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout calling ${event}`))
    }, timeout)

    socket.emit(event, ...args, (response: McpToolResponse) => {
      clearTimeout(timer)
      if (response.success) {
        resolve(response.data as T)
      } else {
        reject(new Error(response.error || 'Unknown error'))
      }
    })
  })
}

// Socket state management
let currentSocket: Socket | null = null
let isReconnecting = false

function setupSocketHandlers(socket: Socket, serverUrl: string): void {
  socket.on('disconnect', (reason) => {
    console.error(`Disconnected from server: ${reason}`)
    currentSocket = null

    if (!isReconnecting && reason !== 'io client disconnect') {
      isReconnecting = true
      reconnectWithRetry(serverUrl, (newSocket) => {
        currentSocket = newSocket
        isReconnecting = false
        setupSocketHandlers(newSocket, serverUrl)
      })
    }
  })
}

async function main() {
  const { serverUrl } = parseArgs()

  // Connect to AI Annotator server
  try {
    currentSocket = await createServerConnection(serverUrl)
    setupSocketHandlers(currentSocket, serverUrl)
  } catch (err) {
    console.error(`Failed to connect to AI Annotator server at ${serverUrl}`)
    console.error('Make sure the server is running: bunx vite-plugin-ai-annotator')
    console.error('Or specify a different server: --server http://localhost:PORT')
    process.exit(1)
  }

  // Create MCP server
  const mcp = new McpServer({
    name: 'ai-annotator',
    version: '1.0.0',
  })

  // Helper for text responses
  const textResponse = (text: string) => ({
    content: [{ type: 'text' as const, text }]
  })

  // Helper to get socket with reconnect trigger
  const getSocket = (): Socket => {
    if (!currentSocket?.connected) {
      triggerImmediateReconnect()
      throw new Error('Not connected to server. Reconnecting...')
    }
    return currentSocket
  }

  // Session param
  const sessionIdParam = z.string().optional().describe('Browser session ID (optional if only one session)')

  // Tool: annotator_list_sessions
  mcp.tool(
    'annotator_list_sessions',
    'List all connected browser sessions',
    {},
    async () => {
      try {
        const sessions = await callServer<BrowserSession[]>(getSocket(), 'mcp:listSessions')
        return textResponse(
          sessions.length > 0
            ? JSON.stringify(sessions, null, 2)
            : 'No browser sessions connected. Add the annotator script to your webpage.'
        )
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )

  // Tool: annotator_get_page_context
  mcp.tool(
    'annotator_get_page_context',
    'Get current page context from browser session (URL, title, feedback count)',
    { sessionId: sessionIdParam },
    async ({ sessionId }) => {
      try {
        const result = await callServer(getSocket(), 'mcp:getPageContext', [sessionId])
        return textResponse(JSON.stringify(result, null, 2))
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
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
      try {
        const result = await callServer<{ success: boolean; count: number; error?: string }>(
          getSocket(), 'mcp:triggerSelection', [sessionId, mode, selector, selectorType]
        )
        return textResponse(
          result.success
            ? `Feedback selection triggered. ${result.count} feedback item(s) selected.`
            : `Feedback selection failed: ${result.error}`
        )
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
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
      try {
        const result = await callServer<Record<string, unknown>[]>(getSocket(), 'mcp:getSelectedElements', [sessionId])
        if (result.length === 0) {
          return textResponse('No feedback selected. Use annotator_select_feedback first.')
        }

        const filtered = filterFeedbackFields(result, fields)
        return textResponse(JSON.stringify(filtered, null, 2))
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )

  // Tool: annotator_capture_screenshot
  mcp.tool(
    'annotator_capture_screenshot',
    'Capture a screenshot (webp) of a specific element. Returns the file path.',
    {
      sessionId: sessionIdParam,
      selector: z.string().describe('CSS selector for the element to capture (required)'),
      quality: z.number().min(0).max(1).default(0.7).describe('Image quality (0-1)'),
    },
    async ({ sessionId, selector, quality }) => {
      try {
        const result = await callServer<{ success: boolean; base64?: string; error?: string }>(
          getSocket(), 'mcp:captureScreenshot', [sessionId, 'element', selector, quality], 30000
        )
        if (result.success && result.base64) {
          const filePath = saveScreenshot(result.base64)
          return textResponse(filePath)
        }
        return textResponse(`Screenshot failed: ${result.error}`)
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )

  // Tool: annotator_clear_feedback
  mcp.tool(
    'annotator_clear_feedback',
    'Clear all selected feedback items in the browser. Removes all UI element selections made for feedback.',
    { sessionId: sessionIdParam },
    async ({ sessionId }) => {
      try {
        await callServer(getSocket(), 'mcp:clearSelection', [sessionId])
        return textResponse('Feedback cleared.')
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
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
      try {
        const result = await callServer<{ success: boolean; error?: string }>(
          getSocket(), 'mcp:injectCSS', [sessionId, css]
        )
        return textResponse(
          result.success ? 'CSS injected successfully.' : `CSS injection failed: ${result.error}`
        )
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
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
      try {
        const result = await callServer<{ success: boolean; result?: unknown; error?: string }>(
          getSocket(), 'mcp:injectJS', [sessionId, code]
        )
        if (result.success) {
          return textResponse(
            result.result !== undefined
              ? `Result: ${JSON.stringify(result.result, null, 2)}`
              : 'JavaScript executed successfully (no return value).'
          )
        }
        return textResponse(`JavaScript execution failed: ${result.error}`)
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
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
      try {
        const result = await callServer<unknown[]>(getSocket(), 'mcp:getConsole', [sessionId, clear])
        return textResponse(
          result.length > 0 ? JSON.stringify(result, null, 2) : 'No console logs captured.'
        )
      } catch (err) {
        return textResponse(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )

  // Start stdio transport
  const transport = new StdioServerTransport()
  await mcp.connect(transport)

  // Handle cleanup
  process.on('SIGINT', () => {
    currentSocket?.disconnect()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    currentSocket?.disconnect()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('MCP CLI error:', err)
  process.exit(1)
})
