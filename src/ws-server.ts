import type { Express, Request, Response } from 'express'
import type { Server } from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import cors from 'cors'
import express from 'express'
import { Server as SocketIOServer, Socket } from 'socket.io'
import { createRpcServer, type RpcServer } from './rpc/server.generated'
import type { BrowserSession } from './rpc/define'
import { createLogger, type Logger } from './utils/logger'
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

// Channel clients (Claude Code MCP channel processes) join this Socket.IO room
// so feedback events from any browser session fan out to all of them.
const CHANNEL_ROOM = 'channels'

function setupSocketIO(io: SocketIOServer, logger: Logger, sessions: Map<string, BrowserConnection>): void {
  io.on('connection', (socket: Socket) => {
    // A connection identifying itself with role=channel is the Claude Code
    // channel MCP server, not a browser. It does not own a BrowserSession.
    const role = socket.handshake.query.role
    if (role === 'channel') {
      socket.join(CHANNEL_ROOM)
      logger.log(`Channel client connected (sid: ${socket.id})`)

      socket.on('channel:notify', (payload: { sessionId?: string; message?: string; status?: string }) => {
        if (!payload?.sessionId || typeof payload.message !== 'string') return
        const conn = sessions.get(payload.sessionId)
        if (!conn) return
        conn.socket.emit('channel:notify', {
          message: payload.message,
          status: payload.status ?? 'info',
        })
      })

      socket.on('disconnect', () => {
        logger.log(`Channel client disconnected (sid: ${socket.id})`)
      })
      return
    }

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

    // Browser explicitly signals "I'm sending feedback to Claude now" (e.g.
    // user pressed the toolbar's send button). Fan out to channel clients so
    // they can push a notifications/claude/channel event into Claude Code.
    socket.on('feedback:submitted', (payload: { count?: number }) => {
      const count = typeof payload?.count === 'number' ? payload.count : 0
      session.lastActivity = Date.now()
      io.to(CHANNEL_ROOM).emit('feedback:submitted', {
        sessionId,
        pageUrl: session.url,
        pageTitle: session.title,
        count,
      })
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

// REST API routes - plain HTTP endpoints for any client
function setupRestApiRoutes(app: Express, logger: Logger, sessions: Map<string, BrowserConnection>): void {
  // Helper: resolve RPC connection or send error response
  function withRpc(res: Response, sessionId?: string): RpcServer | null {
    const result = getRpcOrError(sessions, sessionId)
    if ('error' in result) {
      res.status(400).json({ error: result.error })
      return null
    }
    return result.rpc
  }

  // GET /api/sessions - List all connected browser sessions
  app.get('/api/sessions', (_req: Request, res: Response) => {
    res.json(getAllSessionsList(sessions))
  })

  // GET /api/sessions/:id/page-context
  app.get('/api/sessions/:id/page-context', async (req: Request, res: Response) => {
    const rpc = withRpc(res, req.params.id)
    if (!rpc) return
    try {
      const result = await rpc.client.getPageContext(10000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /api/sessions/:id/select
  // Body: { mode?: "inspect"|"selector", selector?: string, selectorType?: "css"|"xpath" }
  app.post('/api/sessions/:id/select', async (req: Request, res: Response) => {
    const rpc = withRpc(res, req.params.id)
    if (!rpc) return
    const { mode = 'inspect', selector, selectorType = 'css' } = req.body || {}
    try {
      const result = await rpc.client.triggerSelection(mode, selector, selectorType, 10000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET /api/sessions/:id/feedback?fields=xpath,attributes,styles,children
  app.get('/api/sessions/:id/feedback', async (req: Request, res: Response) => {
    const rpc = withRpc(res, req.params.id)
    if (!rpc) return
    try {
      const result = await rpc.client.getSelectedElements(15000)
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
    const rpc = withRpc(res, req.params.id)
    if (!rpc) return
    rpc.client.clearSelection()
    res.json({ success: true })
  })

  // POST /api/sessions/:id/screenshot
  // Body: { type?: "viewport"|"element", selector?: string, quality?: number }
  app.post('/api/sessions/:id/screenshot', async (req: Request, res: Response) => {
    const rpc = withRpc(res, req.params.id)
    if (!rpc) return
    const { type = 'viewport', selector, quality = 0.7 } = req.body || {}
    try {
      const result = await rpc.client.captureScreenshot(type, selector, quality, 30000)
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
    const rpc = withRpc(res, req.params.id)
    if (!rpc) return
    const { css } = req.body || {}
    if (!css) {
      res.status(400).json({ error: 'css field is required' })
      return
    }
    try {
      const result = await rpc.client.injectCSS(css, 10000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /api/sessions/:id/inject-js
  // Body: { code: string }
  app.post('/api/sessions/:id/inject-js', async (req: Request, res: Response) => {
    const rpc = withRpc(res, req.params.id)
    if (!rpc) return
    const { code } = req.body || {}
    if (!code) {
      res.status(400).json({ error: 'code field is required' })
      return
    }
    try {
      const result = await rpc.client.injectJS(code, 15000)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET /api/sessions/:id/console?clear=true
  app.get('/api/sessions/:id/console', async (req: Request, res: Response) => {
    const rpc = withRpc(res, req.params.id)
    if (!rpc) return
    const clear = req.query.clear === 'true'
    try {
      const result = await rpc.client.getConsole(clear, 15000)
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
