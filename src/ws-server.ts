import type { Express, Request, Response } from 'express'
import type { Server } from 'node:http'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import cors from 'cors'
import express from 'express'
import { Server as SocketIOServer, Socket } from 'socket.io'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { createRpcServer, type RpcServer } from './rpc/server.generated'
import { isRpcError } from './rpc/types.generated'
import type { BrowserSession } from './rpc/define'
import { createLogger, type Logger } from './utils/logger'

export interface ServerInstance {
  app: Express
  server: Server
  io: SocketIOServer
  port: number
  listenAddress: string
  publicAddress: string
  verbose: boolean
}

export interface BrowserConnection {
  socket: Socket
  rpc: RpcServer
  session: BrowserSession
}

// Session connection registry (stateless - no "active" session concept)
const sessions = new Map<string, BrowserConnection>()

function generateSessionId(): string {
  return crypto.randomUUID()
}

export function getAllSessions(): BrowserSession[] {
  return Array.from(sessions.values()).map(conn => conn.session)
}

// Get RPC client for a specific session, or auto-select if only one session exists
export function getRpc(sessionId?: string): { rpc: RpcServer; sessionId: string } | null {
  if (sessionId) {
    const conn = sessions.get(sessionId)
    return conn ? { rpc: conn.rpc, sessionId } : null
  }

  // Auto-select if only one session
  if (sessions.size === 1) {
    const entry = sessions.entries().next().value
    if (entry) {
      const [id, conn] = entry
      return { rpc: conn.rpc, sessionId: id }
    }
  }

  return null
}

// Screenshot cache directory
function getScreenshotCacheDir(): string {
  const cacheDir = path.join(os.tmpdir(), 'ai-annotator-screenshots')
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

function saveScreenshot(base64: string, format: 'png' | 'jpeg'): string {
  const cacheDir = getScreenshotCacheDir()
  const timestamp = Date.now()
  const filename = `screenshot-${timestamp}.${format}`
  const filePath = path.join(cacheDir, filename)

  const buffer = Buffer.from(base64, 'base64')
  fs.writeFileSync(filePath, buffer)

  return filePath
}

type FeedbackField = 'xpath' | 'attributes' | 'styles' | 'children'
const BASIC_FIELDS = ['index', 'tagName', 'cssSelector', 'textContent'] as const

function filterFeedbackFields(
  elements: Record<string, unknown>[],
  fields?: FeedbackField[]
): Record<string, unknown>[] {
  return elements.map((el) => {
    const result: Record<string, unknown> = {}
    // basic fields, comment, and componentData are always included
    if ('comment' in el) result.comment = el.comment
    if ('componentData' in el) result.componentData = el.componentData
    for (const f of BASIC_FIELDS) {
      if (f in el) result[f] = el[f]
    }

    // additional fields only if explicitly requested
    if (fields?.includes('xpath') && 'xpath' in el) {
      result.xpath = el.xpath
    }
    if (fields?.includes('attributes') && 'attributes' in el) {
      result.attributes = el.attributes
    }
    if (fields?.includes('styles') && 'computedStyles' in el) {
      result.computedStyles = el.computedStyles
    }
    if (fields?.includes('children') && 'children' in el) {
      result.children = el.children
    }
    return result
  })
}

function setupRoutes(app: Express, publicAddress: string, verbose: boolean): void {
  app.get('/annotator-toolbar.js', (_req, res) => {
    try {
      const isProduction = process.env.NODE_ENV === 'production'
      const filePath = isProduction
        ? path.join(__dirname, 'annotator-toolbar.js')
        : path.join(__dirname, '..', 'dist', 'annotator-toolbar.js')

      const fileContent = fs.readFileSync(filePath, 'utf8')

      res.setHeader('Content-Type', 'application/javascript')

      const wsUrl = publicAddress.replace('http://', 'ws://').replace('https://', 'wss://')
      const injectionCode = `
const toolbar = document.createElement('annotator-toolbar');
toolbar.setAttribute('ws-endpoint', '${wsUrl}');
toolbar.setAttribute('verbose', '${verbose}');
document.body.prepend(toolbar);
`
      res.send(fileContent + injectionCode)
    } catch (error) {
      console.error('Error reading annotator-toolbar.js:', error)
      res.status(404).send('File not found')
    }
  })

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      sessions: sessions.size,
    })
  })

  // API endpoints for session discovery
  app.get('/api/sessions', (_req, res) => {
    res.json(getAllSessions())
  })
}

function setupSocketIO(io: SocketIOServer, logger: Logger): void {
  io.on('connection', (socket: Socket) => {
    const clientType = socket.handshake.query.clientType as string | undefined

    // Handle MCP CLI client
    if (clientType === 'mcp') {
      setupMcpClientSocket(socket, logger)
      return
    }

    // Handle browser client
    const sessionId = generateSessionId()

    const session: BrowserSession = {
      id: sessionId,
      url: '',
      title: '',
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    }

    // Create RPC server for this connection
    const rpc = createRpcServer(socket)

    sessions.set(sessionId, { socket, rpc, session })
    logger.log(`Browser connected: ${sessionId} (total: ${sessions.size})`)

    // Register server-side RPC handlers
    rpc.handle.getSessions(async () => {
      return getAllSessions()
    })

    rpc.handle.ping(async () => {
      return 'pong'
    })

    rpc.handle.rpcError((error) => {
      logger.error('RPC Error:', error)
    })

    // Send session ID to browser
    socket.emit('connected', { sessionId })

    // Update session info when browser reports page context
    socket.on('pageContextChanged', (context: { url: string; title: string }) => {
      session.url = context.url
      session.title = context.title
      session.lastActivity = Date.now()
    })

    socket.on('disconnect', () => {
      rpc.dispose()
      sessions.delete(sessionId)
      logger.log(`Browser disconnected: ${sessionId} (total: ${sessions.size})`)
    })
  })
}

// Setup MCP client socket handlers
function setupMcpClientSocket(socket: Socket, logger: Logger): void {
  logger.log('MCP client connected')

  // mcp:listSessions
  socket.on('mcp:listSessions', (callback: (response: { success: boolean; data?: BrowserSession[]; error?: string }) => void) => {
    callback({ success: true, data: getAllSessions() })
  })

  // mcp:getPageContext
  socket.on('mcp:getPageContext', async (sessionId: string | undefined, callback: (response: { success: boolean; data?: unknown; error?: string }) => void) => {
    const conn = getRpcOrError(sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    try {
      const result = await conn.rpc.client.getPageContext(10000)
      if (isRpcError(result)) {
        callback({ success: false, error: result.message })
      } else {
        callback({ success: true, data: result })
      }
    } catch (err) {
      callback({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // mcp:triggerSelection
  socket.on('mcp:triggerSelection', async (
    sessionId: string | undefined,
    mode: 'inspect' | 'selector',
    selector: string | undefined,
    selectorType: 'css' | 'xpath' | undefined,
    callback: (response: { success: boolean; data?: unknown; error?: string }) => void
  ) => {
    const conn = getRpcOrError(sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    try {
      const result = await conn.rpc.client.triggerSelection(mode, selector, selectorType, 10000)
      if (isRpcError(result)) {
        callback({ success: false, error: result.message })
      } else {
        callback({ success: true, data: result })
      }
    } catch (err) {
      callback({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // mcp:getSelectedElements
  socket.on('mcp:getSelectedElements', async (sessionId: string | undefined, callback: (response: { success: boolean; data?: unknown; error?: string }) => void) => {
    const conn = getRpcOrError(sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    try {
      const result = await conn.rpc.client.getSelectedElements(15000)
      if (isRpcError(result)) {
        callback({ success: false, error: result.message })
      } else {
        callback({ success: true, data: result })
      }
    } catch (err) {
      callback({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // mcp:captureScreenshot
  socket.on('mcp:captureScreenshot', async (
    sessionId: string | undefined,
    type: 'viewport' | 'element',
    selector: string | undefined,
    format: 'png' | 'jpeg' | undefined,
    quality: number | undefined,
    callback: (response: { success: boolean; data?: unknown; error?: string }) => void
  ) => {
    const conn = getRpcOrError(sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    try {
      const result = await conn.rpc.client.captureScreenshot(type, selector, format, quality, 30000)
      if (isRpcError(result)) {
        callback({ success: false, error: result.message })
      } else {
        callback({ success: true, data: result })
      }
    } catch (err) {
      callback({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // mcp:clearSelection
  socket.on('mcp:clearSelection', async (sessionId: string | undefined, callback: (response: { success: boolean; error?: string }) => void) => {
    const conn = getRpcOrError(sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    conn.rpc.client.clearSelection()
    callback({ success: true })
  })

  // mcp:injectCSS
  socket.on('mcp:injectCSS', async (
    sessionId: string | undefined,
    css: string,
    callback: (response: { success: boolean; data?: unknown; error?: string }) => void
  ) => {
    const conn = getRpcOrError(sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    try {
      const result = await conn.rpc.client.injectCSS(css, 10000)
      if (isRpcError(result)) {
        callback({ success: false, error: result.message })
      } else {
        callback({ success: true, data: result })
      }
    } catch (err) {
      callback({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // mcp:injectJS
  socket.on('mcp:injectJS', async (
    sessionId: string | undefined,
    code: string,
    callback: (response: { success: boolean; data?: unknown; error?: string }) => void
  ) => {
    const conn = getRpcOrError(sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    try {
      const result = await conn.rpc.client.injectJS(code, 15000)
      if (isRpcError(result)) {
        callback({ success: false, error: result.message })
      } else {
        callback({ success: true, data: result })
      }
    } catch (err) {
      callback({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // mcp:getConsole
  socket.on('mcp:getConsole', async (
    sessionId: string | undefined,
    clear: boolean | undefined,
    callback: (response: { success: boolean; data?: unknown; error?: string }) => void
  ) => {
    const conn = getRpcOrError(sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    try {
      const result = await conn.rpc.client.getConsole(clear, 15000)
      if (isRpcError(result)) {
        callback({ success: false, error: result.message })
      } else {
        callback({ success: true, data: result })
      }
    } catch (err) {
      callback({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  socket.on('disconnect', () => {
    logger.log('MCP client disconnected')
  })
}

// Helper to get RPC or return error message (shared between MCP client socket and MCP server)
function getRpcOrError(sessionId?: string): { rpc: RpcServer; sessionId: string } | { error: string } {
  const result = getRpc(sessionId)
  if (!result) {
    const allSessions = getAllSessions()
    if (allSessions.length === 0) {
      return { error: 'No browser connected. Add the annotator script to your webpage.' }
    }
    return { error: `Multiple sessions available. Specify sessionId. Available: ${allSessions.map(s => s.id).join(', ')}` }
  }
  return { rpc: result.rpc, sessionId: result.sessionId }
}

// MCP Server setup - Stateless design
// All tools accept optional sessionId - auto-selects if only one session exists
function createMcpServer(): McpServer {
  const mcp = new McpServer({
    name: 'ai-annotator',
    version: '1.0.0',
  })

  // Common session param for all browser-interacting tools
  const sessionIdParam = z.string().optional().describe('Browser session ID (optional if only one session)')

  // Helper to create text response
  function textResponse(text: string) {
    return { content: [{ type: 'text' as const, text }] }
  }

  // Tool: annotator_list_sessions
  mcp.tool(
    'annotator_list_sessions',
    'List all connected browser sessions',
    {},
    async () => {
      const sessionList = getAllSessions()
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
      const conn = getRpcOrError(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.rpc.client.getPageContext(10000)
      if (isRpcError(result)) return textResponse(`Error: ${result.message}`)

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
      const conn = getRpcOrError(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.rpc.client.triggerSelection(mode, selector, selectorType, 10000)
      if (isRpcError(result)) return textResponse(`Error: ${result.message}`)

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
      const conn = getRpcOrError(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.rpc.client.getSelectedElements(15000)
      if (isRpcError(result)) return textResponse(`Error: ${result.message}`)

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
    'Capture a screenshot of the viewport or a specific element. Returns the file path where the screenshot is saved.',
    {
      sessionId: sessionIdParam,
      type: z.enum(['viewport', 'element']).default('viewport').describe('Type of screenshot'),
      selector: z.string().optional().describe('CSS selector for element screenshot'),
      format: z.enum(['png', 'jpeg']).default('png').describe('Image format'),
      quality: z.number().min(0).max(1).default(0.8).describe('Image quality (0-1)'),
    },
    async ({ sessionId, type, selector, format, quality }) => {
      const conn = getRpcOrError(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.rpc.client.captureScreenshot(type, selector, format, quality, 30000)
      if (isRpcError(result)) return textResponse(`Error: ${result.message}`)

      if (result.success && result.base64) {
        const filePath = saveScreenshot(result.base64, format)
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
      const conn = getRpcOrError(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      conn.rpc.client.clearSelection()
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
      const conn = getRpcOrError(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.rpc.client.injectCSS(css, 10000)
      if (isRpcError(result)) return textResponse(`Error: ${result.message}`)

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
      const conn = getRpcOrError(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.rpc.client.injectJS(code, 15000)
      if (isRpcError(result)) return textResponse(`Error: ${result.message}`)

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
      const conn = getRpcOrError(sessionId)
      if ('error' in conn) return textResponse(conn.error)

      const result = await conn.rpc.client.getConsole(clear, 15000)
      if (isRpcError(result)) return textResponse(`Error: ${result.message}`)

      return textResponse(
        result.length > 0 ? JSON.stringify(result, null, 2) : 'No console logs captured.'
      )
    }
  )

  return mcp
}

// MCP routes - Session-based transport management
function setupMcpRoutes(app: Express, logger: Logger): void {
  const mcp = createMcpServer()
  const mcpTransports = new Map<string, StreamableHTTPServerTransport>()

  // MCP endpoint - maintains session state
  app.all('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    let transport: StreamableHTTPServerTransport

    if (sessionId && mcpTransports.has(sessionId)) {
      // Reuse existing transport for this session
      transport = mcpTransports.get(sessionId)!
    } else {
      // Create new transport for new session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })

      // Connect MCP server to this transport
      await mcp.connect(transport)

      // Store transport after connection (session ID is generated during handleRequest)
      transport.onclose = () => {
        // Find and remove this transport from the map
        for (const [id, t] of mcpTransports.entries()) {
          if (t === transport) {
            mcpTransports.delete(id)
            logger.log(`MCP session closed: ${id}`)
            break
          }
        }
      }
    }

    try {
      await transport.handleRequest(req, res, req.body)

      // After first request, store transport with its session ID
      const responseSessionId = res.getHeader('mcp-session-id') as string
      if (responseSessionId && !mcpTransports.has(responseSessionId)) {
        mcpTransports.set(responseSessionId, transport)
        logger.log(`MCP session created: ${responseSessionId}`)
      }
    } catch (error) {
      logger.error('MCP request error:', error)
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' })
      }
    }
  })

  // MCP capabilities endpoint (optional, for discovery)
  app.get('/mcp/info', (_req: Request, res: Response) => {
    res.json({
      name: 'ai-annotator',
      version: '1.0.0',
      capabilities: {
        tools: true,
      },
      endpoint: '/mcp',
    })
  })
}

export async function startServer(
  port: number,
  listenAddress: string,
  publicAddress: string,
  verbose = false
): Promise<ServerInstance> {
  const logger = createLogger(verbose)
  const app = express()

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }))

  app.use(express.json({ limit: '10mb' }))

  setupRoutes(app, publicAddress, verbose)
  setupMcpRoutes(app, logger)

  const server = await listen(app, port, listenAddress)

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  })

  setupSocketIO(io, logger)

  return { app, server, io, port, listenAddress, publicAddress, verbose }
}

export async function stopServer(serverInstance: ServerInstance): Promise<void> {
  return new Promise((resolve) => {
    // Dispose all RPC instances and close connections
    sessions.forEach(({ rpc }) => {
      rpc.dispose()
    })
    sessions.clear()

    // Socket.IO's close() handles closing the underlying HTTP server
    serverInstance.io.close(() => {
      resolve()
    })
  })
}

function listen(app: Express, port: number, listenAddress: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, listenAddress, () => resolve(server))
    server.on('error', (error) => {
      reject(error)
    })
  })
}
