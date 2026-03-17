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
import type { BrowserSession } from './rpc/define'
import { getVersion } from './utils/version'
import { registerMcpTools, type AnnotatorConnection, type GetConnection, type ListSessions } from './mcp-tools'

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

// In-flight call tracking - reject pending promises on disconnect
const pendingCalls = new Set<{ reject: (err: Error) => void }>()

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

// Call server method with timeout and in-flight tracking
function callServer<T>(socket: Socket, event: string, args: unknown[] = [], timeout = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const tracker = { reject }
    pendingCalls.add(tracker)

    const timer = setTimeout(() => {
      pendingCalls.delete(tracker)
      reject(new Error(`Timeout calling ${event}`))
    }, timeout)

    socket.emit(event, ...args, (response: McpToolResponse) => {
      clearTimeout(timer)
      pendingCalls.delete(tracker)
      if (response.success) {
        resolve(response.data as T)
      } else {
        reject(new Error(response.error || 'Unknown error'))
      }
    })
  })
}

// Reject all in-flight calls on disconnect
function rejectPendingCalls(): void {
  const err = new Error('Socket disconnected while call was in-flight')
  for (const tracker of pendingCalls) {
    tracker.reject(err)
  }
  pendingCalls.clear()
}

// Socket state management
let currentSocket: Socket | null = null
let isReconnecting = false

function setupSocketHandlers(socket: Socket, serverUrl: string): void {
  socket.on('disconnect', (reason) => {
    console.error(`Disconnected from server: ${reason}`)
    currentSocket = null
    rejectPendingCalls()

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

// Helper to get socket with reconnect trigger
function getSocket(): Socket {
  if (!currentSocket?.connected) {
    triggerImmediateReconnect()
    throw new Error('Not connected to server. Reconnecting...')
  }
  return currentSocket
}

// Create AnnotatorConnection that bridges through Socket.IO to the ws-server
function createSocketBridgeConnection(sessionId: string): AnnotatorConnection {
  return {
    sessionId,
    async getPageContext(timeout) {
      return callServer(getSocket(), 'mcp:getPageContext', [sessionId], timeout)
    },
    async getSelectedElements(timeout) {
      return callServer(getSocket(), 'mcp:getSelectedElements', [sessionId], timeout)
    },
    async triggerSelection(mode, selector, selectorType, timeout) {
      return callServer(getSocket(), 'mcp:triggerSelection', [sessionId, mode, selector, selectorType], timeout)
    },
    async captureScreenshot(type, selector, quality, timeout) {
      return callServer(getSocket(), 'mcp:captureScreenshot', [sessionId, type, selector, quality], timeout)
    },
    clearSelection() {
      getSocket().emit('mcp:clearSelection', sessionId, () => {})
    },
    async injectCSS(css, timeout) {
      return callServer(getSocket(), 'mcp:injectCSS', [sessionId, css], timeout)
    },
    async injectJS(code, timeout) {
      return callServer(getSocket(), 'mcp:injectJS', [sessionId, code], timeout)
    },
    async getConsole(clear, timeout) {
      return callServer(getSocket(), 'mcp:getConsole', [sessionId, clear], timeout)
    },
  }
}

async function main() {
  const { serverUrl } = parseArgs()

  // Connect to AI Annotator server
  try {
    currentSocket = await createServerConnection(serverUrl)
    setupSocketHandlers(currentSocket, serverUrl)
  } catch {
    console.error(`Failed to connect to AI Annotator server at ${serverUrl}`)
    console.error('Make sure the server is running: bunx vite-plugin-ai-annotator')
    console.error('Or specify a different server: --server http://localhost:PORT')
    process.exit(1)
  }

  // Create MCP server with shared tool definitions
  const mcp = new McpServer({
    name: 'ai-annotator',
    version: getVersion(),
  })

  // listSessions fetches from the server asynchronously via Socket.IO
  const listSessions: ListSessions = async () => {
    try {
      return await callServer<BrowserSession[]>(getSocket(), 'mcp:listSessions')
    } catch {
      return []
    }
  }

  const getConnection: GetConnection = (sessionId?: string) => {
    try {
      getSocket() // verify connection
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
    // Use sessionId or empty string to let server auto-select
    return createSocketBridgeConnection(sessionId || '')
  }

  registerMcpTools(mcp, listSessions, getConnection)

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
