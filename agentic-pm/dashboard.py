"""Master Mind Dashboard - Live Activity Feed for Agentic PM."""
import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from linear_client import LinearDBClient
from config import LINEAR_DB_URL, TEAM_KEY

app = FastAPI(title="Jan Agentic PM Demo")

# Mount static files
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# State tracking for change detection
_seen_issues: dict[str, dict] = {}  # id -> issue data
_seen_comments: set[str] = set()  # comment ids
_events: list[dict] = []  # Event log
_client: LinearDBClient | None = None


async def get_client() -> LinearDBClient:
    """Get or create Linear DB client."""
    global _client
    if _client is None:
        _client = LinearDBClient(LINEAR_DB_URL)
        await _client.initialize()
    return _client


def create_event(event_type: str, data: dict) -> dict:
    """Create a timestamped event."""
    return {
        "type": event_type,
        "timestamp": datetime.now().isoformat(),
        "data": data,
    }


async def poll_for_changes() -> list[dict]:
    """Poll Linear DB and detect changes."""
    global _seen_issues, _seen_comments
    new_events = []
    
    try:
        client = await get_client()
        
        # Get all issues for the team
        result = await client.list_issues(team=TEAM_KEY)
        issues = result.get("data", [])
        
        for issue in issues:
            issue_id = issue["id"]
            identifier = issue.get("identifier", issue_id)
            
            if issue_id not in _seen_issues:
                # New issue created
                new_events.append(create_event("issue_created", {
                    "identifier": identifier,
                    "title": issue.get("title", ""),
                    "priority": issue.get("priority_name", "Normal"),
                    "assignee": issue.get("assignee_name") or issue.get("assignee_email", "Unassigned"),
                    "status": issue.get("status_name", "Backlog"),
                }))
                _seen_issues[issue_id] = issue.copy()
            else:
                # Check for status change
                old_status = _seen_issues[issue_id].get("status_name")
                new_status = issue.get("status_name")
                
                if old_status != new_status:
                    new_events.append(create_event("status_changed", {
                        "identifier": identifier,
                        "title": issue.get("title", ""),
                        "old_status": old_status,
                        "new_status": new_status,
                        "assignee": issue.get("assignee_name") or issue.get("assignee_email", ""),
                    }))
                    _seen_issues[issue_id] = issue.copy()
        
        # Store events
        _events.extend(new_events)
        # Keep only last 100 events
        if len(_events) > 100:
            _events[:] = _events[-100:]
            
    except Exception as e:
        logger.error(f"Poll error: {e}")
    
    return new_events


async def event_generator() -> AsyncGenerator[str, None]:
    """Generate SSE events."""
    # Send initial connected event
    yield f"event: connected\ndata: {json.dumps({'status': 'connected'})}\n\n"
    
    while True:
        try:
            new_events = await poll_for_changes()
            
            for event in new_events:
                yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
            
            # Send heartbeat
            yield f"event: heartbeat\ndata: {json.dumps({'time': datetime.now().isoformat()})}\n\n"
            
        except Exception as e:
            logger.error(f"SSE error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        
        await asyncio.sleep(2)


@app.get("/api/events")
async def sse_events(request: Request):
    """SSE endpoint for real-time events."""
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/issues")
async def get_issues():
    """Get current issues."""
    try:
        client = await get_client()
        result = await client.list_issues(team=TEAM_KEY)
        return {"success": True, "data": result.get("data", [])}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/stats")
async def get_stats():
    """Get summary statistics."""
    try:
        client = await get_client()
        result = await client.list_issues(team=TEAM_KEY)
        issues = result.get("data", [])
        
        total = len(issues)
        backlog = sum(1 for i in issues if i.get("status_type") == "backlog")
        todo = sum(1 for i in issues if i.get("status_type") == "unstarted")
        in_progress = sum(1 for i in issues if i.get("status_type") == "started")
        done = sum(1 for i in issues if i.get("status_type") == "completed")
        
        return {
            "success": True,
            "data": {
                "total": total,
                "backlog": backlog,
                "todo": todo,
                "in_progress": in_progress,
                "done": done,
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/events/history")
async def get_event_history():
    """Get recent event history."""
    return {"success": True, "data": _events[-50:]}


@app.get("/api/gantt")
async def get_gantt_data():
    """Get issues with dependencies for Gantt chart."""
    try:
        client = await get_client()
        result = await client.list_issues(team=TEAM_KEY)
        issues = result.get("data", [])
        
        # Build nodes and edges for visualization
        nodes = []
        edges = []
        
        # Fetch each issue with relations to get blocking info
        for issue in issues:
            identifier = issue.get("identifier", issue["id"])
            
            # Get full issue with relations
            try:
                full_result = await client.get_issue(identifier, include_relations=True)
                issue_data = full_result.get("data", issue)
            except Exception as e:
                logger.warning(f"Failed to get relations for {identifier}: {e}")
                issue_data = issue
            
            # Determine status color
            status_type = issue_data.get("status_type") or "backlog"
            color = {
                "backlog": "#6b7280",
                "unstarted": "#3b82f6",
                "started": "#f59e0b",
                "completed": "#10b981",
                "canceled": "#ef4444",
            }.get(status_type, "#6b7280")
            
            nodes.append({
                "id": issue_data["id"],
                "identifier": issue_data.get("identifier", issue_data["id"]),
                "title": issue_data.get("title", ""),
                "status": issue_data.get("status_name") or status_type,
                "status_type": status_type,
                "assignee": issue_data.get("assignee_name") or "Unassigned",
                "priority": issue_data.get("priority_value", 3),
                "color": color,
                "created_at": issue_data.get("created_at"),
            })
            
            # Add edges for blocking relationships
            blocks = issue_data.get("blocks", [])
            for blocked in blocks:
                blocked_id = blocked.get("id") if isinstance(blocked, dict) else blocked
                edges.append({
                    "from": issue_data["id"],
                    "to": blocked_id,
                    "type": "blocks",
                })
        
        return {"success": True, "data": {"nodes": nodes, "edges": edges}}
    except Exception as e:
        logger.error(f"Gantt data error: {e}")
        return {"success": False, "error": str(e)}


@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    """Serve the dashboard HTML."""
    static_dir = Path(__file__).parent / "static"
    index_file = static_dir / "index.html"
    
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text())
    else:
        return HTMLResponse(content="""
        <html>
            <body>
                <h1>Dashboard not found</h1>
                <p>Please ensure static/index.html exists.</p>
            </body>
        </html>
        """, status_code=404)


@app.get("/gantt", response_class=HTMLResponse)
async def serve_gantt():
    """Serve the Gantt chart HTML."""
    static_dir = Path(__file__).parent / "static"
    gantt_file = static_dir / "gantt.html"
    
    if gantt_file.exists():
        return HTMLResponse(content=gantt_file.read_text())
    else:
        return HTMLResponse(content="Gantt chart not found", status_code=404)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888)
