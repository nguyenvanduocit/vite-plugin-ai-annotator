# vite-plugin-ai-annotator

AI-powered element annotator for Vite - Pick elements and get instant AI code modifications.

[![Watch the Tutorial](https://img.youtube.com/vi/OuKnfCbmfTg/maxresdefault.jpg)](https://youtu.be/OuKnfCbmfTg)
> 📺 **[Watch the Tutorial Video](https://youtu.be/OuKnfCbmfTg)** - See the plugin in action!

## Easy Setup with Claude Code Plugin

Don't want to manually install? Install the **Claude Code plugin** and let AI set everything up for you:

```bash
claude plugin install claude-annotator-plugin@nguyenvanduocit
```

Then just ask Claude: *"Set up ai-annotator for my project"* - it will handle the rest!

## Manual Setup

### Requirements

This plugin requires **Claude Code** CLI:

```bash
bun install -g @anthropic-ai/claude-code
```

> Claude Code is Anthropic's official CLI tool. [Learn more](https://docs.anthropic.com/en/docs/claude-code)

## What can this plugin help you?

After installing the plugin, you can:
- **Point directly at any element** on your webapp
- **Type a short request** like "make it bigger", "center it", "change color to blue"
- **Wait for AI to modify your code** - it automatically finds and updates the source files
- **See instant results** - your changes appear immediately in the browser

> Save cognitive load, because it's precious.

## Quick Start

This is an **ESM-only Vite plugin**. Installation is simple!

### 1. Install

```bash
bun add -d vite-plugin-ai-annotator
```

### 2. Add to Your Vite Config

```typescript
import { defineConfig } from 'vite';
import annotator from 'vite-plugin-ai-annotator';

export default defineConfig({
  plugins: [
    annotator(),
  ],
});
```

### 3. Start Your Dev Server

```bash
bun dev
```

That's it! The annotator toolbar will automatically appear in your application.

## Plugin Options

```typescript
annotator({
  port: 7318,          // Server port (default: 7318)
  verbose: false,      // Enable detailed logging (default: false)
})
```

## Framework Support

Works with all Vite-supported frameworks:

- ⚛️ **React** - Detects components, props, and state
- 🟢 **Vue** - Understands composition/options API
- 🅰️ **Angular** - Recognizes components and directives
- 🟠 **Svelte** - Identifies components and stores
- 📄 **Vanilla JS** - Works with plain HTML/CSS/JS

## Team Collaboration

Want your entire team to modify the app? Configure for network access:

```typescript
annotator({
  port: 7318,
  listenAddress: '0.0.0.0',                // Accept connections from network
  publicAddress: 'https://myapp.com:7318', // Public URL for the toolbar
})
```

Now anyone on your team can:
1. Open the app at `https://myapp.com`
2. Use the annotator toolbar to modify the UI
3. Changes are saved directly to the source files
4. Everyone sees updates in real-time!

**Happy coding! 🚀**
