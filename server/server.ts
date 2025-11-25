#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ServerWebSocket } from "bun";
import fs from "fs/promises";
import path from "path";
import TurndownService from "turndown";

// Thunderbird Client Management - Single client only
interface ThunderbirdClient {
  ws: ServerWebSocket<{ id: string }>;
  id: string;
  addonId?: string;
  connectedAt: Date;
}

let currentClient: ThunderbirdClient | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timeout: Timer }
>();

interface Command {
  type: string;
  requestId?: string;
  payload?: Record<string, unknown>;
}

interface ClientMessage {
  type: string;
  requestId?: string;
  addonId?: string;
  payload?: Record<string, unknown>;
}

// WebSocket Server for Thunderbird Extension
Bun.serve<{ id: string }>({
  port: 37842,
  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: {
          id: crypto.randomUUID(),
        },
      });

      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      return undefined;
    }

    if (url.pathname === "/status") {
      return Response.json({
        connected: currentClient !== null,
        uptime: process.uptime(),
        client: currentClient
          ? {
              id: currentClient.id,
              addonId: currentClient.addonId,
              connectedAt: currentClient.connectedAt,
            }
          : null,
      });
    }

    return new Response("Thunderbird MCP Server Running", { status: 200 });
  },

  websocket: {
    open(ws) {
      // Kick away any existing client
      if (currentClient) {
        currentClient.ws.close(1000, "New client connected");
      }

      const client: ThunderbirdClient = {
        ws,
        id: ws.data.id,
        connectedAt: new Date(),
      };

      currentClient = client;

      ws.send(
        JSON.stringify({
          type: "welcome",
          payload: {
            clientId: client.id,
            timestamp: new Date().toISOString(),
          },
        })
      );
    },

    message(ws, message) {
      if (!currentClient || currentClient.id !== ws.data.id) return;

      try {
        const data: ClientMessage = JSON.parse(message.toString());

        switch (data.type) {
          case "register":
            currentClient.addonId = data.addonId;
            ws.send(
              JSON.stringify({
                type: "registered",
                payload: { success: true },
              })
            );
            break;

          case "heartbeat":
            ws.send(
              JSON.stringify({
                type: "heartbeat_ack",
                payload: { timestamp: new Date().toISOString() },
              })
            );
            break;

          case "response":
            // Handle MCP tool responses
            if (data.requestId) {
              const pending = pendingRequests.get(data.requestId);
              if (pending) {
                clearTimeout(pending.timeout);
                pending.resolve(data.payload);
                pendingRequests.delete(data.requestId);
              }
            }
            break;

          default:
            console.error(`[?] Unknown message type: ${data.type}`);
        }
      } catch (error) {
        console.error(`[!] Error processing message from client:`, error);
      }
    },

    close(ws) {
      if (currentClient && currentClient.id === ws.data.id) {
        currentClient = null;
      }
    },
  },
});

// Server started silently for MCP

// Helper function to send command to the connected Thunderbird client
function sendCommandToThunderbird(command: Command, timeout = 30000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!currentClient) {
      reject(new Error("No Thunderbird client connected. Make sure the addon is loaded."));
      return;
    }

    const requestId = crypto.randomUUID();
    command.requestId = requestId;

    // Set up timeout
    const timeoutTimer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Request timeout"));
    }, timeout);

    pendingRequests.set(requestId, { resolve, reject, timeout: timeoutTimer });

    try {
      currentClient.ws.send(JSON.stringify(command));
    } catch (error) {
      clearTimeout(timeoutTimer);
      pendingRequests.delete(requestId);
      reject(error);
    }
  });
}

// MCP Server Setup
const mcpServer = new Server(
  {
    name: "thunderbird-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define MCP Tools
const tools: Tool[] = [
  {
    name: "list_accounts",
    description: "List all email accounts configured in Thunderbird",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_folders",
    description: "List all folders for a specific account or all accounts",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Optional account ID to list folders for (lists all accounts if not specified)",
        },
      },
    },
  },
  {
    name: "list_unread_emails",
    description: "List all unread emails from all accounts or a specific folder",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Optional account ID to filter emails",
        },
        folderId: {
          type: "string",
          description: "Optional folder ID to filter emails",
        },
        limit: {
          type: "number",
          description: "Maximum number of emails to return (default: 50)",
        },
        includeSpam: {
          type: "boolean",
          description: "Whether to include spam/junk/newsletter folders (default: false)",
        },
        afterDate: {
          type: "string",
          description: "Only return emails after this date (ISO 8601 format, e.g., '2024-01-01T00:00:00Z'). Defaults to no filter.",
        },
      },
    },
  },
  {
    name: "search_emails",
    description: "Search for emails using various criteria",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (searches subject, body, from, to)",
        },
        accountId: {
          type: "string",
          description: "Optional account ID to search within",
        },
        folderId: {
          type: "string",
          description: "Optional folder ID to search within",
        },
        from: {
          type: "string",
          description: "Filter by sender email address",
        },
        to: {
          type: "string",
          description: "Filter by recipient email address",
        },
        subject: {
          type: "string",
          description: "Filter by subject line",
        },
        unread: {
          type: "boolean",
          description: "Filter by unread status",
        },
        flagged: {
          type: "boolean",
          description: "Filter by flagged status",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 50)",
        },
      },
    },
  },
  {
    name: "read_email_raw",
    description: "Read the raw full content of a specific email with all headers and original format",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "number",
          description: "The message ID to read",
        },
        markAsRead: {
          type: "boolean",
          description: "Whether to mark the message as read (default: false)",
        },
      },
      required: ["messageId"],
    },
  },
  {
    name: "read_email",
    description: "Read a specific email with important headers and body converted to markdown format",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "number",
          description: "The message ID to read",
        },
        markAsRead: {
          type: "boolean",
          description: "Whether to mark the message as read (default: false)",
        },
      },
      required: ["messageId"],
    },
  },
  {
    name: "read_email_attachments",
    description: "Download all attachments from a specific email to a folder",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "number",
          description: "The message ID containing the attachments",
        },
        downloadPath: {
          type: "string",
          description: "Local file system path where attachments should be saved",
        },
      },
      required: ["messageId", "downloadPath"],
    },
  },
  {
    name: "send_email",
    description: "Send a new email",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "Array of recipient email addresses",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Array of CC email addresses",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "Array of BCC email addresses",
        },
        subject: {
          type: "string",
          description: "Email subject",
        },
        body: {
          type: "string",
          description: "Email body (plain text or HTML)",
        },
        isHtml: {
          type: "boolean",
          description: "Whether the body is HTML (default: false)",
        },
        accountId: {
          type: "string",
          description: "Account ID to send from (uses default if not specified)",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "download_attachment",
    description: "Download an email attachment to a specified folder",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "number",
          description: "The message ID containing the attachment",
        },
        partName: {
          type: "string",
          description: "The attachment part name/identifier",
        },
        downloadPath: {
          type: "string",
          description: "Local file system path where the attachment should be saved",
        },
      },
      required: ["messageId", "partName", "downloadPath"],
    },
  },
];

// MCP Handlers
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_accounts": {
        const result = await sendCommandToThunderbird({
          type: "list_accounts",
          payload: {},
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_folders": {
        const result = await sendCommandToThunderbird({
          type: "list_folders",
          payload: {
            accountId: args?.accountId,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_unread_emails": {
        const result = await sendCommandToThunderbird({
          type: "list_unread_emails",
          payload: {
            accountId: args?.accountId,
            folderId: args?.folderId,
            limit: args?.limit || 50,
            includeSpam: args?.includeSpam !== undefined ? args.includeSpam : false,
            afterDate: args?.afterDate,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "search_emails": {
        const result = await sendCommandToThunderbird({
          type: "search_emails",
          payload: {
            query: args?.query,
            accountId: args?.accountId,
            folderId: args?.folderId,
            from: args?.from,
            to: args?.to,
            subject: args?.subject,
            unread: args?.unread,
            flagged: args?.flagged,
            limit: args?.limit || 50,
          },
        }, 60000); // 60 second timeout for search

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "read_email_raw": {
        const result = await sendCommandToThunderbird({
          type: "read_email_raw",
          payload: {
            messageId: args?.messageId,
            markAsRead: args?.markAsRead || false,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "read_email": {
        const result = await sendCommandToThunderbird({
          type: "read_email",
          payload: {
            messageId: args?.messageId,
            markAsRead: args?.markAsRead || false,
          },
        });

        // Convert HTML body to markdown if needed
        if (
          result &&
          typeof result === "object" &&
          "success" in result &&
          "message" in result &&
          result.message &&
          typeof result.message === "object" &&
          "isHtml" in result.message &&
          result.message.isHtml
        ) {
          const turndownService = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
            bulletListMarker: "*",
          });

          try {
            if ("body" in result.message && typeof result.message.body === "string") {
              result.message.body = turndownService.turndown(result.message.body);
              delete result.message.isHtml; // Remove the flag after conversion
            }
          } catch (error) {
            console.error("[MCP] Turndown conversion error:", error);
            // Keep original HTML if conversion fails
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "read_email_attachments": {
        const result = await sendCommandToThunderbird({
          type: "read_email_attachments",
          payload: {
            messageId: args?.messageId,
          },
        });

        // Result should contain array of attachments with base64 data
        if (
          result &&
          typeof result === "object" &&
          "success" in result &&
          result.success &&
          "attachments" in result &&
          Array.isArray(result.attachments)
        ) {
          const downloadPath = args?.downloadPath as string;
          const savedFiles: Array<{ filename: string; path: string; size: number }> = [];

          for (const attachment of result.attachments) {
            if (
              typeof attachment === "object" &&
              attachment &&
              "filename" in attachment &&
              "data" in attachment &&
              typeof attachment.filename === "string" &&
              typeof attachment.data === "string"
            ) {
              const filePath = path.join(downloadPath, attachment.filename);
              const buffer = Buffer.from(attachment.data, "base64");

              // Ensure directory exists
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              await fs.writeFile(filePath, buffer);

              savedFiles.push({
                filename: attachment.filename,
                path: filePath,
                size: buffer.length,
              });
            }
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    message: `Downloaded ${savedFiles.length} attachment(s) to ${downloadPath}`,
                    files: savedFiles,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "send_email": {
        const result = await sendCommandToThunderbird({
          type: "send_email",
          payload: {
            to: args?.to,
            cc: args?.cc,
            bcc: args?.bcc,
            subject: args?.subject,
            body: args?.body,
            isHtml: args?.isHtml || false,
            accountId: args?.accountId,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "download_attachment": {
        const result = await sendCommandToThunderbird({
          type: "download_attachment",
          payload: {
            messageId: args?.messageId,
            partName: args?.partName,
          },
        });

        // Result should contain the base64 encoded file data
        if (
          result &&
          typeof result === "object" &&
          "success" in result &&
          result.success &&
          "data" in result &&
          typeof result.data === "string"
        ) {
          const downloadPath = args?.downloadPath as string;
          const buffer = Buffer.from(result.data, "base64");
          const filename =
            "filename" in result && typeof result.filename === "string"
              ? result.filename
              : "attachment";

          // Ensure directory exists
          await fs.mkdir(path.dirname(downloadPath), { recursive: true });
          await fs.writeFile(downloadPath, buffer);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    message: `Attachment saved to ${downloadPath}`,
                    filename,
                    size: buffer.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: errorMessage,
            hint: errorMessage.includes("No Thunderbird client")
              ? "Make sure the Thunderbird addon is loaded and connected to the C&C server"
              : undefined,
          }),
        },
      ],
      isError: true,
    };
  }
});

// Start MCP Server on stdio
async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
