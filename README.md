# vite-plugin-ai-annotator

AI-powered element annotator for Vite - Pick elements and get instant AI code modifications.

[![Watch the Tutorial](https://img.youtube.com/vi/OuKnfCbmfTg/maxresdefault.jpg)](https://youtu.be/OuKnfCbmfTg)
> 📺 **[Watch the Tutorial Video](https://youtu.be/OuKnfCbmfTg)** - See the plugin in action!

## What is this?

Point at any element on your webapp, type a request, and AI modifies your code instantly.

- **Point directly at any element** on your webapp
- **Type a short request** like "make it bigger", "center it", "change color to blue"
- **Wait for AI to modify your code** - it automatically finds and updates the source files
- **See instant results** - your changes appear immediately in the browser

> Save cognitive load, because it's precious.

## Why use it?

Traditional workflow: inspect element → find source file → locate the code → make changes → check results.

With this plugin: point → describe → done.

Works with all Vite-supported frameworks:
- ⚛️ **React** - Detects components, props, and state
- 🟢 **Vue** - Understands composition/options API
- 🅰️ **Angular** - Recognizes components and directives
- 🟠 **Svelte** - Identifies components and stores
- 📄 **Vanilla JS** - Works with plain HTML/CSS/JS

## Installation

### Option 1: Automatic Setup (Recommended)

Install the **Claude Code plugin** and let AI set everything up for you:

```bash
/plugin marketplace add nguyenvanduocit/claude-annotator-plugin
/plugin install claude-annotator-plugin@claude-annotator-plugin
```

Then ask Claude: *"Set up ai-annotator for my project"* - it handles the rest!

### Option 2: Manual Setup

#### Step 1: Install the package

```bash
bun add -d vite-plugin-ai-annotator
```

#### Step 2: Add to your Vite config

```typescript
import { defineConfig } from 'vite';
import annotator from 'vite-plugin-ai-annotator';

export default defineConfig({
  plugins: [
    annotator(),
  ],
});
```

#### Step 3: Configure MCP

**Option A: Auto Setup (Recommended)**

Enable automatic MCP configuration in your Vite config:

```typescript
annotator({
  autoSetupMcp: true,
})
```

This automatically creates/updates `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` based on your project.

**Option B: Manual Setup**

```bash
claude mcp add annotator -- npx vite-plugin-ai-annotator mcp -s http://localhost:7318
```

#### Step 4: Start your dev server

```bash
bun dev
```

The annotator toolbar will automatically appear in your application.

## Usage

1. Click the **inspect button** on the toolbar to enter feedback mode
2. Click on any element(s) you want to provide feedback on
3. Ask Claude Code to modify them - it will use `annotator_get_feedback` to get the selected feedback with their source locations
4. Claude modifies the source code directly

Example prompt: *"Make the selected button larger and change its color to blue"*

## Configuration

```typescript
annotator({
  port: 7318,           // Server port (default: 7318)
  autoSetupMcp: true,   // Auto-configure MCP files (default: false)
  verbose: false,       // Enable detailed logging (default: false)
})
```

### Auto MCP Setup

When `autoSetupMcp: true`, the plugin automatically:

1. **Detects your package manager** from lockfile:
   - `bun.lockb` / `bun.lock` → uses `bunx`
   - `pnpm-lock.yaml` → uses `pnpm dlx`
   - Otherwise → uses `npx`

2. **Creates/updates MCP config files**:
   - `.mcp.json` - Claude Code, Cline, Roo Code
   - `.cursor/mcp.json` - Cursor (only if `.cursor/` exists)
   - `.vscode/mcp.json` - VS Code (only if `.vscode/` exists)

3. **Preserves existing config** - merges with other MCP servers, doesn't overwrite

**Happy coding! 🚀**
