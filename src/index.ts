#!/usr/bin/env node

import { startServer, stopServer, type ServerInstance } from './ws-server'
import { createServer } from 'net'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Read version from package.json
function getVersion(): string {
  const possiblePaths = [
    join(__dirname, '..', 'package.json'),
    join(__dirname, 'package.json'),
    join(process.cwd(), 'package.json'),
  ]

  for (const pkgPath of possiblePaths) {
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        if (pkg.name === 'vite-plugin-ai-annotator' && pkg.version) {
          return pkg.version
        }
      } catch {
        continue
      }
    }
  }
  return '0.0.0'
}

const VERSION = getVersion()
const args = process.argv.slice(2)
const subcommand = args[0]

// Handle 'mcp' subcommand - delegate to mcp-stdio
if (subcommand === 'mcp') {
  import('./mcp-stdio').catch((err) => {
    console.error('Failed to start MCP CLI:', err)
    process.exit(1)
  })
} else {
  runServer()
}

async function runServer() {
  const helpFlag = args.includes('--help') || args.includes('-h')
  const versionFlag = args.includes('--version') || args.includes('-v')
  const verboseFlag = args.includes('--verbose') || args.includes('-V')
  const skipMcpInstructions = args.includes('--skip-mcp-instructions')
  const portFlag = args.findIndex(arg => arg === '--port' || arg === '-p')
  const listenFlag = args.findIndex(arg => arg === '--listen' || arg === '-l')
  const publicAddressFlag = args.findIndex(arg => arg === '--public-address' || arg === '-a')

  if (helpFlag) {
    console.log(`
AI Annotator - AI-powered web inspection tool

Usage:
  bunx vite-plugin-ai-annotator [command] [options]

Commands:
  mcp --server <url>            Run as MCP stdio server (for Claude Code)
  (default)                     Start the WebSocket server

MCP Options:
  -s, --server <url>            Server URL (REQUIRED)

Server Options:
  -p, --port <number>           Port to run the server on (default: 7318)
  -l, --listen <address>        Address to bind server to (default: localhost)
  -a, --public-address <url>    Public URL for reverse proxy
  -V, --verbose                 Enable verbose logging
  -h, --help                    Show this help message
  -v, --version                 Show version number

Examples:
  bunx vite-plugin-ai-annotator                               # Start server
  bunx vite-plugin-ai-annotator --port 8080                   # Start on port 8080
  bunx vite-plugin-ai-annotator mcp -s http://localhost:7318  # Run MCP stdio

Claude Code MCP Config (~/.claude/settings.json):
  "mcpServers": {
    "ai-annotator": {
      "command": "bunx",
      "args": ["vite-plugin-ai-annotator", "mcp", "-s", "http://localhost:7318"]
    }
  }

Learn more: https://github.com/nguyenvanduocit/instantCode
`)
    process.exit(0)
  }

  if (versionFlag) {
    console.log(`AI Annotator v${VERSION}`)
    process.exit(0)
  }

  // Parse port
  let port = 7318
  if (process.env.INSPECTOR_PORT) {
    const envPort = parseInt(process.env.INSPECTOR_PORT, 10)
    if (!isNaN(envPort) && envPort > 0 && envPort < 65536) port = envPort
  } else if (process.env.PORT) {
    const envPort = parseInt(process.env.PORT, 10)
    if (!isNaN(envPort) && envPort > 0 && envPort < 65536) port = envPort
  }

  if (portFlag !== -1 && args[portFlag + 1]) {
    const parsedPort = parseInt(args[portFlag + 1], 10)
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort < 65536) {
      port = parsedPort
    } else {
      console.error('❌ Invalid port number.')
      process.exit(1)
    }
  }

  // Parse listen address
  let listenAddress = 'localhost'
  if (listenFlag !== -1 && args[listenFlag + 1]) {
    listenAddress = args[listenFlag + 1]
    if (!['localhost', '127.0.0.1', '0.0.0.0', '::1', '::'].includes(listenAddress)) {
      console.error('❌ Invalid listen address.')
      process.exit(1)
    }
  }

  // Parse public address
  let publicAddress = ''
  if (publicAddressFlag !== -1 && args[publicAddressFlag + 1]) {
    publicAddress = args[publicAddressFlag + 1]
    try {
      new URL(publicAddress)
    } catch {
      console.error('❌ Invalid public address.')
      process.exit(1)
    }
  }
  if (!publicAddress) {
    publicAddress = `http://${listenAddress}:${port}`
  }

  const isVerbose = verboseFlag || process.env.VERBOSE === 'true'

  // Check port availability
  const isPortAvailable = await checkPortAvailability(port)
  if (!isPortAvailable) {
    console.error(`❌ Port ${port} is already in use.`)
    process.exit(1)
  }

  // Start server
  let serverInstance: ServerInstance | null = null
  let isShuttingDown = false

  try {
    serverInstance = await startServer(port, listenAddress, publicAddress, isVerbose)

    console.log(`✅ AI Annotator server started on ${publicAddress}`)

    if (!skipMcpInstructions) {
      console.log(``)
      console.log(`📋 Claude Code MCP Config (~/.claude/settings.json):`)
      console.log(``)
      console.log(`  "mcpServers": {`)
      console.log(`    "ai-annotator": {`)
      console.log(`      "command": "bunx",`)
      console.log(`      "args": ["vite-plugin-ai-annotator", "mcp", "-s", "${publicAddress}"]`)
      console.log(`    }`)
      console.log(`  }`)
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error instanceof Error ? error.message : error)
    process.exit(1)
  }

  // Graceful shutdown
  async function gracefulShutdown() {
    if (isShuttingDown) return
    isShuttingDown = true

    console.log('\n\nShutting down server...')
    if (serverInstance) {
      try {
        await stopServer(serverInstance)
        console.log('Server stopped successfully')
      } catch (error) {
        console.error('Error stopping server:', error)
      }
    }
    process.exit(0)
  }

  process.on('SIGINT', gracefulShutdown)
  process.on('SIGTERM', gracefulShutdown)
}

function checkPortAvailability(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port)
  })
}
