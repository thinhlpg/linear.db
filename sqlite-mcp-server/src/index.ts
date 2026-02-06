import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
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

// Create Express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", server: "linear-sqlite-mcp" });
});

// Session management - store transports and servers by session ID
const sessions: Map<string, { transport: StreamableHTTPServerTransport; server: Server }> = new Map();

// MCP endpoint - POST for client-to-server messages
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    // Check if we have an existing session
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (session) {
        // Reuse existing session
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      // Session ID provided but not found - return 404 per spec
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      });
      return;
    }

    // No session ID - this should be an initialize request
    // Create new transport and server
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (newSessionId: string) => {
        console.log(`Session initialized: ${newSessionId}`);
        sessions.set(newSessionId, { transport, server });
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        console.log(`Session closed: ${sid}`);
        sessions.delete(sid);
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

// MCP endpoint - GET for SSE streams
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  
  if (!sessionId) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: Mcp-Session-Id header is required" },
      id: null,
    });
    return;
  }
  
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
    return;
  }
  
  await session.transport.handleRequest(req, res);
});

// MCP endpoint - DELETE for session termination
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`Session terminated: ${sessionId}`);
    }
  }
  res.status(200).end();
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Linear SQLite MCP Server running on http://localhost:${PORT}/mcp`);
  console.log(`Protocol: Streamable HTTP (MCP 2025-06-18 spec)`);
});

// Handle server shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down server...");
  for (const [sessionId, session] of sessions) {
    console.log(`Closing session: ${sessionId}`);
    await session.transport.close();
  }
  sessions.clear();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
