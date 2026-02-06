import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { initializeDatabase } from "./schema.js";

// Import tool handlers - each module exports its tools and a registration function
import { registerIssueTools, getIssueTools } from "./tools/issues.js";
import { registerProjectTools, getProjectTools } from "./tools/projects.js";
import { registerTeamTools, getTeamTools } from "./tools/teams.js";
import { registerLabelTools, getLabelTools } from "./tools/labels.js";
import { registerCycleTools, getCycleTools } from "./tools/cycles.js";
import { registerCommentTools, getCommentTools } from "./tools/comments.js";
import { registerUserTools, getUserTools } from "./tools/users.js";

// Initialize database schema
initializeDatabase();

// All registered tool handlers
const toolHandlers: Record<string, (args: any) => Promise<any>> = {};

function registerToolHandler(name: string, handler: (args: any) => Promise<any>) {
  toolHandlers[name] = handler;
}

// Register all tools
registerIssueTools(registerToolHandler);
registerProjectTools(registerToolHandler);
registerTeamTools(registerToolHandler);
registerLabelTools(registerToolHandler);
registerCycleTools(registerToolHandler);
registerCommentTools(registerToolHandler);
registerUserTools(registerToolHandler);

// List all tools
const allTools = [
  ...getIssueTools(),
  ...getProjectTools(),
  ...getTeamTools(),
  ...getLabelTools(),
  ...getCycleTools(),
  ...getCommentTools(),
  ...getUserTools(),
];

// Function to create a new MCP server instance
function createServer(): Server {
  const server = new Server(
    { name: "linear-sqlite-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Set up request handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers[name];

    if (!handler) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2) }],
        isError: true,
      };
    }

    try {
      const result = await handler(args || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}

// Create Express app with DNS rebinding protection
const app = createMcpExpressApp();

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", server: "linear-sqlite-mcp" });
});

// Session management - store transports by session ID
const transports: Record<string, { transport: StreamableHTTPServerTransport; server: Server }> = {};

// MCP endpoint - POST for client-to-server messages
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    // Reuse existing session if available
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }

    // Create new session for any request (auto-initialize mode)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid) => {
        transports[sid] = { transport, server };
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && transports[sid]) {
        delete transports[sid];
      }
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: error.message || "Internal server error" },
        id: null,
      });
    }
  }
});

// MCP endpoint - GET for SSE streams (return 405 - not supported in stateless mode)
app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).set("Allow", "POST").send("Method Not Allowed");
});

// MCP endpoint - DELETE for session termination
app.delete("/mcp", (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && transports[sessionId]) {
    transports[sessionId].transport.close();
    delete transports[sessionId];
  }
  res.status(200).end();
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Linear SQLite MCP Server running on http://localhost:${PORT}/mcp`);
});

// Handle server shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  for (const { transport } of Object.values(transports)) {
    await transport.close();
  }
  process.exit(0);
});
