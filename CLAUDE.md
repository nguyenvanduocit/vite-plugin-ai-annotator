# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: vite-plugin-ai-annotator (InstantCode)

AI-powered element annotator for Vite. Enables visual element selection in the browser with AI-assisted code modifications via Claude Code integration.

## Commands

```bash
# Development
bun src/index.ts              # Start server in dev mode

# Build (all)
bun run build                 # Server + annotator + vite-plugin + types

# Build (individual)
bun run build:server          # CJS bundle → dist/index.cjs
bun run build:annotator       # IIFE browser bundle → dist/annotator-toolbar.js
bun run build:vite-plugin     # ESM bundle → dist/vite-plugin.js
bun run build:types           # Declaration files

# Type checking
bun run typecheck             # tsc --noEmit

# Link for local dev
bun run build && bun link     # Then: bun link vite-plugin-ai-annotator in target project
```

## Architecture

```
Server (Node.js)                     Browser
├─ index.ts (entry, CLI args)        ├─ annotator-toolbar.ts (Lit Web Component)
├─ ws-server.ts (Socket.IO)  ◄─────► │   ├─ Shadow DOM isolation
├─ mcp-stdio.ts (MCP server)         │   ├─ Element selection/inspection
└─ vite-plugin.ts (spawns server)    │   └─ Framework detection
                                     └─ rpc/client.generated.ts
```

**Communication Flow:**
1. Vite plugin spawns server process on port 7318
2. Browser toolbar connects via Socket.IO
3. Claude Code connects via MCP stdio protocol
4. RPC calls flow: MCP → Server → Browser (and back)

## Key Directories

- `src/rpc/define.ts` - RPC interface definitions (source of truth for client/server contracts)
- `src/rpc/*.generated.ts` - Auto-generated from define.ts, regenerate with socketrpc-gen
- `src/annotator/` - Browser-side selection, detection, inspection logic
- `scripts/` - esbuild build configurations

## Build System Details

Three separate bundles with different targets:

| Bundle | Entry | Format | Platform | Output |
|--------|-------|--------|----------|--------|
| Server | src/index.ts | CJS | Node 18+ | dist/index.cjs |
| Vite Plugin | src/vite-plugin.ts | ESM | Node | dist/vite-plugin.js |
| Toolbar | src/annotator-toolbar.ts | IIFE | Browser ES2020 | dist/annotator-toolbar.js |

## RPC System

Defined in `src/rpc/define.ts`:
- **ServerFunctions**: MCP/external clients call these (getSessions, ping)
- **ClientFunctions**: Server calls browser for these (getPageContext, captureScreenshot, triggerSelection, injectCSS, injectJS, etc.)

To regenerate RPC code after modifying define.ts, use socketrpc-gen.

## Important Notes

- ESM-only Vite plugin (no CJS support)
- Default port: 7318
- Framework detection: Vue, React, Angular, Svelte, vanilla
- Uses Lit for browser component with Shadow DOM isolation
- MCP integration for Claude Code communication

## Git Commits

Follow Conventional Commits:
```
feat(plugin): add new feature
fix(server): handle disconnection
docs: update README
```

Scopes: `plugin`, `server`, `toolbar`, `build`, `rpc`, `mcp`
