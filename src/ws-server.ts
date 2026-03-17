import type { Express, Request, Response } from 'express'
import type { Server } from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import cors from 'cors'
import express from 'express'
import { Server as SocketIOServer, Socket } from 'socket.io'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createRpcServer, type RpcServer } from './rpc/server.generated'
import type { BrowserSession } from './rpc/define'
import { createLogger, type Logger } from './utils/logger'
import { getVersion } from './utils/version'
import { registerMcpTools, type AnnotatorConnection, type GetConnection, type ListSessions } from './mcp-tools'
import { saveScreenshot, filterFeedbackFields, type FeedbackField } from './utils/screenshot'

export interface ServerInstance {
  app: Express
  server: Server
  io: SocketIOServer
  port: number
  listenAddress: string
  publicAddress: string
  verbose: boolean
  getAllSessions(): BrowserSession[]
  getRpc(sessionId?: string): { rpc: RpcServer; sessionId: string } | null
}

export interface BrowserConnection {
  socket: Socket
  rpc: RpcServer
  session: BrowserSession
}

function generateSessionId(): string {
  return crypto.randomUUID()
}

function setupRoutes(app: Express, publicAddress: string, verbose: boolean, sessions: Map<string, BrowserConnection>): void {
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
    res.json(getAllSessionsList(sessions))
  })
}

function getAllSessionsList(sessions: Map<string, BrowserConnection>): BrowserSession[] {
  return Array.from(sessions.values()).map(conn => conn.session)
}

function getRpcFromSessions(sessions: Map<string, BrowserConnection>, sessionId?: string): { rpc: RpcServer; sessionId: string } | null {
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

// Setup thin Socket.IO event forwarding for mcp-stdio bridge clients.
// These are NOT MCP tool definitions (no schemas/descriptions) - just event handlers
// that forward calls to the browser RPC. MCP tool logic lives in mcp-tools.ts.
function setupMcpClientSocket(socket: Socket, logger: Logger, sessions: Map<string, BrowserConnection>): void {
  logger.log('MCP client connected')

  type Callback<T = unknown> = (response: { success: boolean; data?: T; error?: string }) => void

  // Helper: resolve connection, call async fn, return result via callback
  async function withConnection<T>(
    sessionId: string | undefined,
    callback: Callback<T>,
    fn: (conn: AnnotatorConnection) => Promise<T>
  ): Promise<void> {
    const conn = getRpcOrError(sessions, sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    try {
      const ac = createAnnotatorConnection(conn.rpc, conn.sessionId)
      const result = await fn(ac)
      callback({ success: true, data: result })
    } catch (err) {
      callback({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  socket.on('mcp:listSessions', (callback: Callback) => {
    callback({ success: true, data: getAllSessionsList(sessions) })
  })

  socket.on('mcp:getPageContext', (sessionId: string | undefined, callback: Callback) => {
    withConnection(sessionId, callback, (c) => c.getPageContext(10000))
  })

  socket.on('mcp:triggerSelection', (
    sessionId: string | undefined, mode: 'inspect' | 'selector',
    selector: string | undefined, selectorType: 'css' | 'xpath' | undefined,
    callback: Callback
  ) => {
    withConnection(sessionId, callback, (c) => c.triggerSelection(mode, selector, selectorType, 10000))
  })

  socket.on('mcp:getSelectedElements', (sessionId: string | undefined, callback: Callback) => {
    withConnection(sessionId, callback, (c) => c.getSelectedElements(15000))
  })

  socket.on('mcp:captureScreenshot', (
    sessionId: string | undefined, type: 'viewport' | 'element',
    selector: string | undefined, quality: number | undefined,
    callback: Callback
  ) => {
    withConnection(sessionId, callback, (c) => c.captureScreenshot(type, selector, quality, 30000))
  })

  socket.on('mcp:clearSelection', (sessionId: string | undefined, callback: Callback) => {
    const conn = getRpcOrError(sessions, sessionId)
    if ('error' in conn) {
      callback({ success: false, error: conn.error })
      return
    }
    createAnnotatorConnection(conn.rpc, conn.sessionId).clearSelection()
    callback({ success: true })
  })

  socket.on('mcp:injectCSS', (sessionId: string | undefined, css: string, callback: Callback) => {
    withConnection(sessionId, callback, (c) => c.injectCSS(css, 10000))
  })

  socket.on('mcp:injectJS', (sessionId: string | undefined, code: string, callback: Callback) => {
    withConnection(sessionId, callback, (c) => c.injectJS(code, 15000))
  })

  socket.on('mcp:getConsole', (sessionId: string | undefined, clear: boolean | undefined, callback: Callback) => {
    withConnection(sessionId, callback, (c) => c.getConsole(clear, 15000))
  })

  socket.on('disconnect', () => {
    logger.log('MCP client disconnected')
  })
}

function setupSocketIO(io: SocketIOServer, logger: Logger, sessions: Map<string, BrowserConnection>): void {
  io.on('connection', (socket: Socket) => {
    const clientType = socket.handshake.query.clientType as string | undefined

    // Handle MCP CLI client (stdio bridge)
    if (clientType === 'mcp') {
      setupMcpClientSocket(socket, logger, sessions)
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
      return getAllSessionsList(sessions)
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

// Helper to get RPC or return error message
function getRpcOrError(sessions: Map<string, BrowserConnection>, sessionId?: string): { rpc: RpcServer; sessionId: string } | { error: string } {
  const result = getRpcFromSessions(sessions, sessionId)
  if (!result) {
    const allSessions = getAllSessionsList(sessions)
    if (allSessions.length === 0) {
      return { error: 'No browser connected. Add the annotator script to your webpage.' }
    }
    return { error: `Multiple sessions available. Specify sessionId. Available: ${allSessions.map(s => s.id).join(', ')}` }
  }
  return { rpc: result.rpc, sessionId: result.sessionId }
}

// Adapt RPC server into AnnotatorConnection interface
function createAnnotatorConnection(rpc: RpcServer, sessionId: string): AnnotatorConnection {
  return {
    sessionId,
    getPageContext: (timeout) => rpc.client.getPageContext(timeout),
    getSelectedElements: (timeout) => rpc.client.getSelectedElements(timeout),
    triggerSelection: (mode, selector, selectorType, timeout) => rpc.client.triggerSelection(mode, selector, selectorType, timeout),
    captureScreenshot: (type, selector, quality, timeout) => rpc.client.captureScreenshot(type, selector, quality, timeout),
    clearSelection: () => rpc.client.clearSelection(),
    injectCSS: (css, timeout) => rpc.client.injectCSS(css, timeout),
    injectJS: (code, timeout) => rpc.client.injectJS(code, timeout),
    getConsole: (clear, timeout) => rpc.client.getConsole(clear, timeout),
  }
}

// MCP Server setup using shared tool definitions
function createMcpServer(sessions: Map<string, BrowserConnection>): McpServer {
  const mcp = new McpServer({
    name: 'ai-annotator',
    version: getVersion(),
  })

  const listSessions: ListSessions = async () => getAllSessionsList(sessions)

  const getConnection: GetConnection = (sessionId?: string) => {
    const conn = getRpcOrError(sessions, sessionId)
    if ('error' in conn) return { error: conn.error }
    return createAnnotatorConnection(conn.rpc, conn.sessionId)
  }

  registerMcpTools(mcp, listSessions, getConnection)

  return mcp
}

// MCP routes - Session-based transport management
function setupMcpRoutes(app: Express, logger: Logger, sessions: Map<string, BrowserConnection>): void {
  const mcp = createMcpServer(sessions)
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
        sessionIdGenerator: () => {
          const id = crypto.randomUUID()
          // Store transport immediately after ID generation to prevent leak
          mcpTransports.set(id, transport)
          logger.log(`MCP session created: ${id}`)
          return id
        },
      })

      // Connect MCP server to this transport
      try {
        await mcp.connect(transport)
      } catch (error) {
        logger.error('Failed to connect MCP transport:', error)
        res.status(500).json({ error: 'Failed to initialize MCP session' })
        return
      }

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
      version: getVersion(),
      capabilities: {
        tools: true,
      },
      endpoint: '/mcp',
    })
  })
}

// REST API routes - plain HTTP endpoints for any client
function setupRestApiRoutes(app: Express, logger: Logger, sessions: Map<string, BrowserConnection>): void {
  // Helper: resolve connection or send error response
  function withConn(res: Response, sessionId?: string): AnnotatorConnection | null {
    const result = getRpcOrError(sessions, sessionId)
    if ('error' in result) {
      res.status(400).json({ error: result.error })
      return null
    }
    return createAnnotatorConnection(result.rpc, result.sessionId)
  }

  // GET /api/sessions - List all connected browser sessions
  app.get('/api/sessions', (_req: Request, res: Response) => {
    res.json(getAllSessionsList(sessions))
  })

  // GET /api/sessions/:id/page-context
  app.get('/api/sessions/:id/page-context', async (req: Request, res: Response) => {
    const conn = withConn(res, req.params.id)
    if (!conn) return
    try {
      const result = await conn.getPageContext(10000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /api/sessions/:id/select
  // Body: { mode?: "inspect"|"selector", selector?: string, selectorType?: "css"|"xpath" }
  app.post('/api/sessions/:id/select', async (req: Request, res: Response) => {
    const conn = withConn(res, req.params.id)
    if (!conn) return
    const { mode = 'inspect', selector, selectorType = 'css' } = req.body || {}
    try {
      const result = await conn.triggerSelection(mode, selector, selectorType, 10000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET /api/sessions/:id/feedback?fields=xpath,attributes,styles,children
  app.get('/api/sessions/:id/feedback', async (req: Request, res: Response) => {
    const conn = withConn(res, req.params.id)
    if (!conn) return
    try {
      const result = await conn.getSelectedElements(15000)
      if (Array.isArray(result) && result.length === 0) {
        res.json([])
        return
      }
      const fieldsParam = req.query.fields as string | undefined
      const fields = fieldsParam?.split(',').filter(Boolean) as FeedbackField[] | undefined
      const filtered = filterFeedbackFields(result as unknown as Record<string, unknown>[], fields)
      res.json(filtered)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // DELETE /api/sessions/:id/feedback
  app.delete('/api/sessions/:id/feedback', (req: Request, res: Response) => {
    const conn = withConn(res, req.params.id)
    if (!conn) return
    conn.clearSelection()
    res.json({ success: true })
  })

  // POST /api/sessions/:id/screenshot
  // Body: { type?: "viewport"|"element", selector?: string, quality?: number }
  app.post('/api/sessions/:id/screenshot', async (req: Request, res: Response) => {
    const conn = withConn(res, req.params.id)
    if (!conn) return
    const { type = 'viewport', selector, quality = 0.7 } = req.body || {}
    try {
      const result = await conn.captureScreenshot(type, selector, quality, 30000)
      if ('success' in result && result.success && 'base64' in result && result.base64) {
        const filePath = saveScreenshot(result.base64 as string)
        res.json({ success: true, filePath })
      } else {
        res.json(result)
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /api/sessions/:id/inject-css
  // Body: { css: string }
  app.post('/api/sessions/:id/inject-css', async (req: Request, res: Response) => {
    const conn = withConn(res, req.params.id)
    if (!conn) return
    const { css } = req.body || {}
    if (!css) {
      res.status(400).json({ error: 'css field is required' })
      return
    }
    try {
      const result = await conn.injectCSS(css, 10000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /api/sessions/:id/inject-js
  // Body: { code: string }
  app.post('/api/sessions/:id/inject-js', async (req: Request, res: Response) => {
    const conn = withConn(res, req.params.id)
    if (!conn) return
    const { code } = req.body || {}
    if (!code) {
      res.status(400).json({ error: 'code field is required' })
      return
    }
    try {
      const result = await conn.injectJS(code, 15000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET /api/sessions/:id/console?clear=true
  app.get('/api/sessions/:id/console', async (req: Request, res: Response) => {
    const conn = withConn(res, req.params.id)
    if (!conn) return
    const clear = req.query.clear === 'true'
    try {
      const result = await conn.getConsole(clear, 15000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  logger.log('REST API routes registered at /api/*')
}

export async function startServer(
  port: number,
  listenAddress: string,
  publicAddress: string,
  verbose = false
): Promise<ServerInstance> {
  const logger = createLogger(verbose)
  const app = express()
  const sessions = new Map<string, BrowserConnection>()

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }))

  app.use(express.json({ limit: '10mb' }))

  setupRoutes(app, publicAddress, verbose, sessions)
  setupRestApiRoutes(app, logger, sessions)
  setupMcpRoutes(app, logger, sessions)

  const server = await listen(app, port, listenAddress)

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
    maxHttpBufferSize: 50e6, // 50MB for large screenshots
  })

  setupSocketIO(io, logger, sessions)

  return {
    app,
    server,
    io,
    port,
    listenAddress,
    publicAddress,
    verbose,
    getAllSessions: () => getAllSessionsList(sessions),
    getRpc: (sessionId?: string) => getRpcFromSessions(sessions, sessionId),
  }
}

export async function stopServer(serverInstance: ServerInstance): Promise<void> {
  return new Promise((resolve) => {
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
