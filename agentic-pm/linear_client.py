"""Linear DB MCP Client - HTTP transport."""
import httpx
from typing import Any
from loguru import logger


class LinearDBClient:
    """Client for Linear DB MCP server."""
    
    def __init__(self, base_url: str = "http://localhost:3335/mcp"):
        self.base_url = base_url
        self.session_id: str | None = None
        self._request_id = 0
    
    async def _request(self, method: str, params: dict | None = None) -> dict:
        """Send JSON-RPC request to Linear DB MCP server."""
        self._request_id += 1
        
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["mcp-session-id"] = self.session_id
        
        payload = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params or {},
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(self.base_url, json=payload, headers=headers)
            
            # Capture session ID from response
            if "mcp-session-id" in response.headers:
                self.session_id = response.headers["mcp-session-id"]
            
            data = response.json()
            if "error" in data:
                raise Exception(f"MCP Error: {data['error']}")
            return data.get("result", {})
    
    async def initialize(self) -> None:
        """Initialize MCP session."""
        await self._request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "agentic-pm", "version": "1.0.0"}
        })
        logger.info(f"Connected to Linear DB, session: {self.session_id}")
    
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
