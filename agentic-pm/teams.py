"""Agent Teams Orchestrator - Uses Claude Code Agent Teams for multi-agent execution."""
import asyncio
import os
import pty
import select
import subprocess
import sys
import re
from pathlib import Path
from datetime import datetime
from loguru import logger

from linear_client import LinearDBClient
from config import LINEAR_DB_URL, TEAM_KEY, TEAM_NAME


TEAM_PROMPT = """You are leading a development team to complete this project.

## TEAM STRUCTURE
You have access to multiple parallel agents that can work simultaneously:
- **PM Agent (You)**: Analyze requirements, break into tasks, coordinate work
- **Worker Agents**: Implement code, write tests, create documentation

## COORDINATION RULES
1. Break the project into independent, parallel tasks when possible
2. Assign clear responsibilities to each worker
3. Use messaging to coordinate dependencies
4. Create all deliverables in the ./workspace/ directory

## PROJECT REQUIREMENTS
{prd}

## DELIVERABLES
Execute this project with your team. Ensure:
1. All code is functional and tested
2. Create files in ./workspace/
3. Report completion status for each task

Begin execution now."""


async def setup_linear_db(client: LinearDBClient) -> None:
    """Ensure team and standard labels exist in Linear DB."""
    teams = await client.list_teams()
    team_exists = any(t.get("key") == TEAM_KEY for t in teams.get("data", []))
    
    if not team_exists:
        logger.info(f"Creating team {TEAM_NAME} ({TEAM_KEY})")
        await client.create_team(TEAM_NAME, TEAM_KEY)
        
        # Create standard labels
        labels = [
            ("code", "#5e6ad2"),
            ("test", "#4EA7FC"),
            ("docs", "#26B5CE"),
            ("feature", "#6FCF97"),
            ("in-progress", "#F2C94C"),
            ("agent-teams", "#BB6BD9"),
        ]
        for name, color in labels:
            try:
                await client.create_label(TEAM_KEY, name, color)
            except Exception:
                pass


async def create_tracking_issue(client: LinearDBClient, prd: str) -> dict:
    """Create a parent issue to track the Agent Teams execution."""
    result = await client.create_issue(
        team=TEAM_KEY,
        title=f"[Agent Teams] {prd[:50]}...",
        description=f"""## Project PRD
{prd}

## Execution Method
Using Claude Code Agent Teams (experimental) for parallel multi-agent execution.

## Status
Started: {datetime.now().isoformat()}
""",
        labels=["agent-teams", "feature"],
        priority=2,
    )
    
    if result.get("success"):
        issue = result["data"]
        logger.info(f"Created tracking issue: {issue['identifier']}")
        return issue
    else:
        logger.error(f"Failed to create tracking issue: {result.get('error')}")
        return {}


async def update_issue_status(client: LinearDBClient, issue_id: str, status: str, comment: str = None):
    """Update issue status and optionally add a comment."""
    await client.update_issue(issue_id, state=status)
    if comment:
        await client.create_comment(issue_id, comment)


def parse_task_from_output(line: str) -> dict | None:
    """Parse task creation signals from Claude output."""
    # Look for patterns like "Creating task: <title>" or "Task: <title>"
    patterns = [
        r"(?:Creating|Starting|Working on)\s+(?:task|issue)?:?\s*['\"]?(.+?)['\"]?\s*$",
        r"Task\s*\d*:?\s*['\"]?(.+?)['\"]?\s*$",
        r"\[TASK\]\s*(.+)",
    ]
    
    for pattern in patterns:
        match = re.search(pattern, line, re.IGNORECASE)
        if match:
            return {"title": match.group(1).strip()}
    
    return None


def parse_completion_from_output(line: str) -> bool:
    """Check if line indicates task completion."""
    completion_patterns = [
        r"(?:completed|finished|done|created)\s+(?:task|file|successfully)",
        r"✅|✓|DONE|COMPLETED",
        r"Task\s+completed",
    ]
    
    for pattern in completion_patterns:
        if re.search(pattern, line, re.IGNORECASE):
            return True
    
    return False


async def run_agent_teams(prd: str, working_dir: str = ".") -> dict:
    """Run Claude Code with Agent Teams enabled and sync to Linear DB."""
    
    # Ensure workspace directory exists
    workspace = Path(working_dir) / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    
    # Initialize Linear DB client
    client = LinearDBClient(LINEAR_DB_URL)
    await client.initialize()
    
    # Setup team and labels
    await setup_linear_db(client)
    
    # Create tracking issue
    tracking_issue = await create_tracking_issue(client, prd)
    issue_id = tracking_issue.get("id")
    
    if issue_id:
        await update_issue_status(client, issue_id, "In Progress", 
                                   "🚀 Agent Teams execution started...")
    
    # Build Claude command
    prompt = TEAM_PROMPT.format(prd=prd)
    cmd = [
        "claude",
        "--dangerously-skip-permissions",
        "--output-format", "text",
        "-p", prompt,
    ]
    
    # Setup environment with Agent Teams enabled
    env = os.environ.copy()
    env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"
    
    logger.info("Starting Claude Code Agent Teams...")
    logger.info(f"Working directory: {working_dir}")
    logger.info(f"PRD: {prd[:100]}...")
    
    # Track created sub-issues for tasks
    sub_issues = []
    output_lines = []
    
    try:
        logger.info(f"Running command: {' '.join(cmd)}")
        
        # Create pseudo-terminal for better output capture
        master_fd, slave_fd = pty.openpty()
        
        proc = subprocess.Popen(
            cmd,
            cwd=working_dir,
            env=env,
            stdout=slave_fd,
            stderr=slave_fd,
            stdin=slave_fd,
            close_fds=True,
        )
        
        os.close(slave_fd)  # Close slave in parent
        
        # Read output with timeout
        timeout = 300  # 5 minutes max
        start_time = asyncio.get_event_loop().time()
        
        while True:
            # Check if process finished
            poll_result = proc.poll()
            if poll_result is not None:
                exit_code = poll_result
                break
            
            # Check timeout
            if asyncio.get_event_loop().time() - start_time > timeout:
                logger.warning("Timeout reached, terminating process")
                proc.terminate()
                proc.wait()
                exit_code = -1
                break
            
            # Read available output
            ready, _, _ = select.select([master_fd], [], [], 0.5)
            if ready:
                try:
                    data = os.read(master_fd, 4096).decode('utf-8', errors='replace')
                    if data:
                        for line in data.split('\n'):
                            line = line.strip()
                            if line:
                                output_lines.append(line)
                                logger.info(f"[Claude] {line}")
                                
                                # Parse for task signals
                                task_info = parse_task_from_output(line)
                                if task_info:
                                    # Create sub-issue in Linear DB
                                    result = await client.create_issue(
                                        team=TEAM_KEY,
                                        title=task_info["title"],
                                        description=f"Sub-task created by Agent Teams\n\nParent: {tracking_issue.get('identifier', 'N/A')}",
                                        labels=["code", "agent-teams"],
                                        priority=3,
                                    )
                                    if result.get("success"):
                                        sub_issue = result["data"]
                                        sub_issues.append(sub_issue)
                                        await client.update_issue(sub_issue["id"], state="In Progress")
                                        logger.info(f"Created sub-issue: {sub_issue['identifier']}")
                                
                                # Check for completions
                                if parse_completion_from_output(line) and sub_issues:
                                    # Mark latest sub-issue as done
                                    latest = sub_issues[-1]
                                    await client.update_issue(latest["id"], state="Done")
                                    logger.info(f"Marked {latest['identifier']} as Done")
                except OSError:
                    break
        
        os.close(master_fd)
        
    except Exception as e:
        logger.error(f"Agent Teams execution failed: {e}")
        exit_code = 1
        if issue_id:
            await update_issue_status(client, issue_id, "Cancelled",
                                       f"❌ Execution failed: {e}")
    
    # Final status update
    if issue_id:
        if exit_code == 0:
            # List created files
            files = list(workspace.glob("**/*"))
            file_list = "\n".join(f"- {f.relative_to(workspace)}" for f in files if f.is_file())
            
            await update_issue_status(
                client, issue_id, "Done",
                f"""✅ Agent Teams execution completed!

**Exit code**: {exit_code}
**Sub-tasks created**: {len(sub_issues)}

**Files created**:
{file_list or "No files found in workspace/"}

**Output summary**:
```
{chr(10).join(output_lines[-20:])}
```
"""
            )
        else:
            await update_issue_status(
                client, issue_id, "Cancelled",
                f"❌ Execution failed with exit code {exit_code}"
            )
    
    return {
        "success": exit_code == 0,
        "exit_code": exit_code,
        "tracking_issue": tracking_issue,
        "sub_issues": sub_issues,
        "output_lines": output_lines,
        "workspace": str(workspace),
    }


async def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: python teams.py '<PRD text>'")
        print("\nExample:")
        print('  python teams.py "Build a Flappy Bird HTML game with canvas rendering"')
        print("\nThis uses Claude Code Agent Teams (experimental) for parallel multi-agent execution.")
        print("Results are tracked in Linear DB and visible on the dashboard.")
        sys.exit(1)
    
    prd = sys.argv[1]
    working_dir = sys.argv[2] if len(sys.argv) > 2 else "."
    
    result = await run_agent_teams(prd, working_dir)
    
    if result["success"]:
        print(f"\n✅ Agent Teams completed successfully!")
        print(f"   Tracking issue: {result['tracking_issue'].get('identifier', 'N/A')}")
        print(f"   Sub-tasks: {len(result['sub_issues'])}")
        print(f"   Workspace: {result['workspace']}")
    else:
        print(f"\n❌ Agent Teams failed with exit code {result['exit_code']}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
