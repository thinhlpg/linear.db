"""Linear DB MCP Client - Streamable HTTP transport (MCP 2025-06-18 spec)."""
import httpx
from typing import Any
from loguru import logger


# MCP Protocol version - use the latest supported by the SDK
MCP_PROTOCOL_VERSION = "2024-11-05"


class LinearDBClient:
    """Client for Linear DB MCP server with Streamable HTTP transport.
    
    Implements MCP Streamable HTTP transport specification:
    - Session management via Mcp-Session-Id header
    - Protocol version via MCP-Protocol-Version header
    - JSON response mode (enableJsonResponse: true on server)
    """
    
    def __init__(self, base_url: str = "http://localhost:3335/mcp"):
        self.base_url = base_url
        self.session_id: str | None = None
        self._initialized: bool = False
        self._request_id = 0
        self._client: httpx.AsyncClient | None = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create persistent HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client
    
    async def close(self) -> None:
        """Close the HTTP client connection and terminate session."""
        if self.session_id and self._client and not self._client.is_closed:
            # Send DELETE to terminate session per spec
            try:
                await self._client.delete(
                    self.base_url,
                    headers={"mcp-session-id": self.session_id}
                )
            except Exception:
                pass  # Ignore errors during cleanup
        
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
        
        self.session_id = None
        self._initialized = False
    
    async def health_check(self) -> bool:
        """Check if server is reachable."""
        try:
            client = await self._get_client()
            health_url = self.base_url.replace("/mcp", "/health")
            response = await client.get(health_url)
            return response.status_code == 200
        except Exception as e:
            logger.debug(f"Health check failed: {e}")
            return False
    
    async def _request(self, method: str, params: dict | None = None) -> dict:
        """Send JSON-RPC request to Linear DB MCP server.
        
        Per MCP Streamable HTTP spec:
        - Client MUST include Accept header with both application/json and text/event-stream
        - Client MUST include Mcp-Session-Id header on all requests after initialization
        - Client MUST include MCP-Protocol-Version header on all requests after initialization
        """
        self._request_id += 1
        
        # Build headers per MCP spec
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        
        # Include session ID on all requests after initialization
        if self.session_id:
            headers["mcp-session-id"] = self.session_id
        
        # Include protocol version on all requests after initialization
        if self._initialized:
            headers["MCP-Protocol-Version"] = MCP_PROTOCOL_VERSION
        
        payload = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params or {},
        }
        
        client = await self._get_client()
        
        try:
            response = await client.post(self.base_url, json=payload, headers=headers)
        except httpx.ConnectError as e:
            raise Exception(f"Cannot connect to MCP server at {self.base_url}: {e}")
        except httpx.TimeoutException as e:
            raise Exception(f"Request timeout: {e}")
        
        # Capture session ID from response (set during initialization)
        if "mcp-session-id" in response.headers:
            new_session_id = response.headers["mcp-session-id"]
            if self.session_id is None:
                logger.debug(f"Session established: {new_session_id}")
            self.session_id = new_session_id
        
        # Handle HTTP errors per spec
        if response.status_code == 404:
            # Session not found - need to re-initialize
            self.session_id = None
            self._initialized = False
            raise Exception("Session not found - need to re-initialize")
        
        if response.status_code >= 400:
            error_text = response.text[:500] if response.text else "No error details"
            raise Exception(f"HTTP {response.status_code}: {error_text}")
        
        # Handle 202 Accepted (for notifications/responses)
        if response.status_code == 202:
            return {}
        
        # Handle empty responses
        if not response.content:
            raise Exception("Empty response from server")
        
        # Parse JSON response
        try:
            data = response.json()
        except Exception as e:
            raise Exception(f"Invalid JSON response: {response.text[:200]}")
        
        if "error" in data:
            raise Exception(f"MCP Error: {data['error']}")
        return data.get("result", {})
    
    async def initialize(self) -> None:
        """Initialize MCP session.
        
        Per MCP spec:
        - First request must be 'initialize' without session ID
        - Server responds with session ID in Mcp-Session-Id header
        - Client must include session ID in all subsequent requests
        """
        result = await self._request("initialize", {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "agentic-pm", "version": "1.0.0"}
        })
        self._initialized = True
        logger.info(f"MCP initialized - session: {self.session_id}, protocol: {MCP_PROTOCOL_VERSION}")
    
    async def call_tool(self, name: str, arguments: dict) -> dict:
        """Call an MCP tool."""
        result = await self._request("tools/call", {"name": name, "arguments": arguments})
        # Parse the text content from MCP response
        if "content" in result and result["content"]:
            import json
            text = result["content"][0].get("text", "{}")
            return json.loads(text)
        return result
    
    # === Team operations ===
    
    async def create_team(self, name: str, key: str) -> dict:
        """Create a new team."""
        return await self.call_tool("create_team", {"name": name, "key": key})
    
    async def list_teams(self) -> dict:
        """List all teams."""
        return await self.call_tool("list_teams", {})
    
    # === User operations ===
    
    async def create_user(self, name: str, email: str) -> dict:
        """Create a new user."""
        return await self.call_tool("create_user", {"name": name, "email": email})
    
    async def list_users(self) -> dict:
        """List all users."""
        return await self.call_tool("list_users", {})
    
    # === Issue operations ===
    
    async def create_issue(
        self,
        team: str,
        title: str,
        description: str | None = None,
        assignee: str | None = None,
        labels: list[str] | None = None,
        priority: int = 3,
        blocks: list[str] | None = None,
        blocked_by: list[str] | None = None,
    ) -> dict:
        """Create a new issue with optional dependencies."""
        args = {"team": team, "title": title, "priority": priority}
        if description:
            args["description"] = description
        if assignee:
            args["assignee"] = assignee
        if labels:
            args["labels"] = labels
        if blocks:
            args["blocks"] = blocks
        if blocked_by:
            args["blocked_by"] = blocked_by
        return await self.call_tool("create_issue", args)
    
    async def list_issues(
        self,
        team: str | None = None,
        assignee: str | None = None,
        state: str | None = None,
        include_relations: bool = False,
    ) -> dict:
        """List issues with optional filters."""
        args = {}
        if team:
            args["team"] = team
        if assignee:
            args["assignee"] = assignee
        if state:
            args["state"] = state
        if include_relations:
            args["includeRelations"] = True
        return await self.call_tool("list_issues", args)
    
    async def get_issue(self, issue_id: str, include_relations: bool = False) -> dict:
        """Get a single issue with optional relations."""
        args = {"id": issue_id}
        if include_relations:
            args["includeRelations"] = True
        return await self.call_tool("get_issue", args)
    
    async def update_issue(
        self,
        issue_id: str,
        state: str | None = None,
        assignee: str | None = None,
        title: str | None = None,
        description: str | None = None,
    ) -> dict:
        """Update an issue."""
        args = {"id": issue_id}
        if state:
            args["state"] = state
        if assignee:
            args["assignee"] = assignee
        if title:
            args["title"] = title
        if description:
            args["description"] = description
        return await self.call_tool("update_issue", args)
    
    # === Comment operations ===
    
    async def create_comment(self, issue_id: str, body: str) -> dict:
        """Add a comment to an issue."""
        return await self.call_tool("create_comment", {"issue": issue_id, "body": body})
    
    # === Label operations ===
    
    async def create_label(self, team: str, name: str, color: str = "#5e6ad2") -> dict:
        """Create a label."""
        return await self.call_tool("create_issue_label", {
            "team": team, "name": name, "color": color
        })
