# Development Guide

## Project Structure

```
thunderbird-mcp/
├── addon/              # Thunderbird WebExtension
│   ├── background.js   # Main extension logic (182 lines)
│   ├── background_handlers.js  # Command handlers (388 lines)
│   └── manifest.json   # Extension manifest
└── server/             # MCP Server (Bun + TypeScript)
    └── server.ts       # Combined MCP + WebSocket server
```

## Setup

### Server

```bash
cd server
bun install
bun run dev
```

### Addon

Install in Thunderbird:
1. Tools → Developer Tools → Debug Add-ons
2. Load Temporary Add-on
3. Select `addon/manifest.json`

## Development Scripts

### Server
```bash
cd server
bun run lint         # Check for linting errors
bun run lint:fix     # Auto-fix linting errors  
bun run typecheck    # Type-check TypeScript
bun run dev          # Run server
```

### Addon
```bash
cd addon
bun install          # Install dev dependencies
bun run lint         # Check for linting errors
bun run lint:fix     # Auto-fix linting errors
```

## Architecture

### Single Client Model
The server maintains **one active client** at a time:
- New client connections kick away existing clients
- `currentClient` variable (not a Map)
- Simple, predictable behavior

### Communication Flow
```
AI Assistant (Claude)
    ↕ stdio (MCP protocol)
MCP Server (server.ts)
    ↕ WebSocket (localhost:3000)
Thunderbird Extension
    ↕ WebExtension APIs
Thunderbird
```

### Handler Pattern
Commands are routed through `handleCommand()` to specific handlers:
- `background.js`: Routes commands (90 lines)
- `background_handlers.js`: Implements handlers (388 lines)
- Clean separation of concerns
- Easy to add new commands

## Linting Setup

- **Server**: TypeScript + ESLint with strict rules
- **Addon**: ESLint for JavaScript
  - `background_handlers.js`: no-unused-vars disabled (handlers exported globally)
  - `background.js`: Handlers imported as globals
