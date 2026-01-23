# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project: vite-plugin-ai-annotator

AI-powered element annotator for Vite - ESM-only Vite plugin.

## Commands

### Development
- **Run development server**: `bun src/index.ts`
- **Type checking**: `bunx tsc --noEmit`
- **Build**: `bun run build`
- **Build annotator toolbar**: `bun run build:annotator`
- **Build vite plugin**: `bun run build:vite-plugin`

### Testing & Validation
- **Type check**: `bunx tsc --noEmit`

## Development Setup

### Local Development
```bash
# Start the server
bun src/index.ts
```

### Using in Another Project
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import annotator from 'vite-plugin-ai-annotator';

export default defineConfig({
  plugins: [
    annotator({ verbose: true }),
  ],
});
```

### Link for Development
```bash
# In this directory
bun run build && bun link

# In target project
bun link vite-plugin-ai-annotator
```

## Architecture

### Core Components
- **src/index.ts**: Server entry point
- **src/ws-server.ts**: WebSocket server with Socket.IO RPC
- **src/vite-plugin.ts**: Vite plugin (ESM-only)
- **src/annotator-toolbar.ts**: Browser toolbar component

### Browser Component
The annotator toolbar is a self-contained Web Component that:
- Uses Shadow DOM for style isolation
- Detects frameworks (Vue, React, Angular, Svelte)
- Communicates with server via Socket.IO RPC

## Build System

- **Server**: esbuild to CJS for Node.js
- **Vite Plugin**: esbuild to ESM
- **Browser Component**: esbuild to IIFE bundle

## Key Notes

- ESM-only - no CJS support for the Vite plugin
- Default port: 7318
- Uses Socket.IO for real-time communication
- Integrates with Claude Code for AI assistance

## Git Commit Guidelines

Follow **Conventional Commits**:
```
feat(plugin): add new feature
fix(server): handle disconnection
docs: update README
```

Scopes: `plugin`, `server`, `toolbar`, `build`
