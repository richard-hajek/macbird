# Thunderbird MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with access to Thunderbird email functionality through a WebSocket connection to a Thunderbird extension.

## Architecture

This project combines three components:

1. **MCP Server** - Runs on stdio and provides MCP tools to AI assistants
2. **WebSocket Server** - Connects to the Thunderbird extension on `ws://localhost:37842/ws`
3. **Thunderbird Extension** - WebExtension that interfaces with Thunderbird APIs

```
AI Assistant (Claude, etc.)
    ↕ stdio (MCP protocol)
MCP Server (server.ts)
    ↕ WebSocket (localhost:37842)
Thunderbird Extension
    ↕ Thunderbird WebExtension APIs
Thunderbird Email Client
```

## Quick Start

### 1. Install Server Dependencies

```bash
cd server
bun install
```

### 2. Load the Thunderbird Extension

1. Open Thunderbird
2. Go to **Tools → Developer Tools → Debug Add-ons**
3. Click **"Load Temporary Add-on"**
4. Navigate to `addon/` directory and select `manifest.json`

The extension will automatically connect to the MCP server.

### 3. Configure MCP Client

Add to your MCP client configuration:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "thunderbird": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/thunderbird-mcp/server/server.ts"]
    }
  }
}
```

**Other MCP clients**:
```bash
bun run /path/to/server/server.ts
```

### 4. Start Using!

Once configured, your AI assistant can access your email through the following tools.

## Available Tools

### `list_accounts`
List all email accounts configured in Thunderbird.

```javascript
list_accounts()
// Returns: { accounts: [...], count: N }
```

### `list_folders`
List all folders for a specific account or all accounts.

**Parameters:**
- `accountId` (optional): Filter by account ID

```javascript
list_folders()
list_folders({ accountId: "account1" })
```

### `list_unread_emails`
List all unread emails from all accounts or a specific folder.

**Parameters:**
- `accountId` (optional): Filter by account ID
- `folderId` (optional): Filter by folder ID
- `limit` (optional): Maximum number of emails (default: 50)
- `includeSpam` (optional): Include spam/junk/newsletter folders (default: false)
- `afterDate` (optional): Only emails after this date (ISO 8601 format)

```javascript
list_unread_emails()
list_unread_emails({ accountId: "account1", limit: 20 })
list_unread_emails({ afterDate: "2024-01-01T00:00:00Z" })
```

### `search_emails`
Search for emails using various criteria.

**Parameters:**
- `query` (optional): Search query for subject/body/from/to
- `from` (optional): Filter by sender
- `to` (optional): Filter by recipient
- `subject` (optional): Filter by subject
- `unread` (optional): Filter by unread status
- `flagged` (optional): Filter by flagged status
- `limit` (optional): Maximum results (default: 50)

```javascript
search_emails({ from: "john@example.com" })
search_emails({ query: "invoice", unread: true })
```

### `read_email_raw`
Read the raw full content of a specific email with all headers and original format.

**Parameters:**
- `messageId` (required): The message ID to read
- `markAsRead` (optional): Mark as read (default: false)

```javascript
read_email_raw({ messageId: 12345, markAsRead: true })
```

### `read_email`
Read a specific email with important headers and body converted to markdown.

**Parameters:**
- `messageId` (required): The message ID to read
- `markAsRead` (optional): Mark as read (default: false)

```javascript
read_email({ messageId: 12345, markAsRead: true })
// Returns clean markdown-formatted email body
```

### `send_email`
Send a new email.

**Parameters:**
- `to` (required): Array of recipient email addresses
- `subject` (required): Email subject
- `body` (required): Email body
- `cc` (optional): Array of CC addresses
- `bcc` (optional): Array of BCC addresses
- `isHtml` (optional): Whether body is HTML (default: false)
- `accountId` (optional): Account to send from

```javascript
send_email({
  to: ["recipient@example.com"],
  subject: "Hello from MCP",
  body: "This email was sent via the Thunderbird MCP server!",
  cc: ["cc@example.com"]
})
```

### `read_email_attachments`
Download all attachments from a specific email to a folder.

**Parameters:**
- `messageId` (required): Message ID containing the attachments
- `downloadPath` (required): Local path where files should be saved

```javascript
read_email_attachments({
  messageId: 12345,
  downloadPath: "/home/user/Downloads"
})
```

### `download_attachment`
Download a single specific attachment.

**Parameters:**
- `messageId` (required): Message ID containing the attachment
- `partName` (required): Attachment part name/identifier
- `downloadPath` (required): Local path where file should be saved

```javascript
download_attachment({
  messageId: 12345,
  partName: "1.2",
  downloadPath: "/home/user/Downloads/document.pdf"
})
```

## Usage Example

Once configured, you can use these tools through your AI assistant:

```
You: "Can you check my unread emails?"
AI: *uses list_unread_emails tool*
AI: "You have 5 unread emails. The most recent is from..."

You: "Search for emails from john@example.com about the project"
AI: *uses search_emails tool*
AI: "I found 3 emails from john@example.com..."

You: "Read that email and convert it to markdown"
AI: *uses read_email tool*
AI: "Here's the email in markdown format: ..."

You: "Send a reply"
AI: *uses send_email tool*
AI: "I've sent the reply."
```

## Development

### Project Structure

```
thunderbird-mcp/
├── addon/                      # Thunderbird WebExtension
│   ├── background.js           # Main extension logic (182 lines)
│   ├── background_handlers.js  # Command handlers (388 lines)
│   └── manifest.json           # Extension manifest
├── server/                     # MCP Server
│   └── server.ts               # Combined MCP + WebSocket server
├── DEVELOPMENT.md              # Development guide
└── README.md                   # This file
```

### Development Scripts

**Server:**
```bash
cd server
bun run lint         # Check for linting errors
bun run lint:fix     # Auto-fix linting errors  
bun run typecheck    # Type-check TypeScript
bun run dev          # Run server
```

**Addon:**
```bash
cd addon
bun install          # Install dev dependencies
bun run lint         # Check for linting errors
bun run lint:fix     # Auto-fix linting errors
```

### Running the Server Directly

```bash
cd server
bun run server.ts
```

This starts both:
- MCP server on stdio
- WebSocket server on `ws://localhost:37842/ws`

### Checking Connection Status

Visit `http://localhost:37842/status` to see the connected Thunderbird client.

### Debugging

The server logs to stderr (visible in MCP client logs). The addon logs to the Thunderbird console (Ctrl+Shift+J).

## Features

- ✅ **HTML to Markdown conversion** - Emails are converted to clean markdown using Turndown
- ✅ **Single client model** - New connections kick away old ones for simplicity
- ✅ **Auto-reconnect** - Extension automatically reconnects every 5 seconds if disconnected
- ✅ **Spam filtering** - Automatically excludes spam/junk/newsletter folders by default
- ✅ **Date filtering** - Filter emails by date
- ✅ **Type-safe** - Server written in TypeScript with strict type checking
- ✅ **Linted** - Both server and addon have ESLint configured
- ✅ **Modular handlers** - Clean separation of command handling logic

## Troubleshooting

### "No Thunderbird client connected"
- Ensure the Thunderbird extension is loaded
- Check that Thunderbird is running
- Look for connection messages in the Thunderbird console (Ctrl+Shift+J)

### WebSocket Connection Failed
- The extension will auto-reconnect every 5 seconds
- Check that port 37842 is not in use: `lsof -i :37842`
- Look for CSP (Content Security Policy) errors in Thunderbird console

### MCP Tools Not Working
- Ensure the server is started by the MCP client (check logs)
- Verify the command path in your MCP client configuration is correct
- Check that `bun` is installed and in your PATH

### Search Timing Out
- The search has a 25-second timeout in the extension
- Try being more specific with your search query
- Use `list_unread_emails` instead for simpler queries

## Security Notes

This server provides direct access to your email. Only use it with trusted AI assistants and on secure networks. The WebSocket server only accepts connections from localhost by default.

## Port Configuration

The server uses port **37842** to avoid conflicts with common development ports (3000, 8080, etc.). You can change this in:
- `server/server.ts` - Line 43
- `addon/background.js` - Line 7
- `addon/manifest.json` - Line 83

## License

MIT
