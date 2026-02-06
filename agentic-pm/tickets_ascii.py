"""ASCII Ticket Viewer - Display Linear DB tickets in terminal."""
import asyncio
import sys
from linear_client import LinearDBClient
from config import LINEAR_DB_URL, TEAM_KEY


async def list_tickets():
    """List all tickets in ASCII table format."""
    client = LinearDBClient(LINEAR_DB_URL)
    await client.initialize()
    issues = (await client.list_issues(team=TEAM_KEY)).get("data", [])
    
    print("┌─────────┬────────────────────────────────────┬─────────────┐")
    print("│ ID      │ Title                              │ Status      │")
    print("├─────────┼────────────────────────────────────┼─────────────┤")
    for i in issues:
        id = i.get("identifier", "?")[:7].ljust(7)
        title = i.get("title", "?")[:34].ljust(34)
        status = i.get("status_name", "?")[:11].ljust(11)
        print(f"│ {id} │ {title} │ {status} │")
    print("└─────────┴────────────────────────────────────┴─────────────┘")
    print(f"\nTotal: {len(issues)} tickets")


async def summary(user=None):
    """Show progress summary with ASCII progress bar."""
    client = LinearDBClient(LINEAR_DB_URL)
    await client.initialize()
    issues = (await client.list_issues(team=TEAM_KEY)).get("data", [])
    
    # Count by status
    stats = {}
    for i in issues:
        s = i.get("status_name", "Other")
        stats[s] = stats.get(s, 0) + 1
    
    total = len(issues)
    done = stats.get("Done", 0)
    in_progress = stats.get("In Progress", 0)
    backlog = stats.get("Backlog", 0) + stats.get("Todo", 0)
    
    # Progress bar
    bar_width = 20
    done_bars = int((done / total) * bar_width) if total > 0 else 0
    
    print("╔══════════════════════════════════════╗")
    print("║       PROJECT PROGRESS SUMMARY       ║")
    print("╠══════════════════════════════════════╣")
    print(f"║  Done:        {done:3} / {total:3}  {'█' * done_bars}{'░' * (bar_width - done_bars)} ║")
    print(f"║  In Progress: {in_progress:3}                       ║")
    print(f"║  Backlog:     {backlog:3}                       ║")
    print("╚══════════════════════════════════════╝")


async def show_ticket(identifier):
    """Show details of a specific ticket."""
    client = LinearDBClient(LINEAR_DB_URL)
    await client.initialize()
    result = await client.get_issue(identifier)
    
    if not result.get("success"):
        print(f"Ticket {identifier} not found")
        return
    
    issue = result["data"]
    
    print("╔══════════════════════════════════════════════════════════╗")
    print(f"║ {issue.get('identifier', '?'):^56} ║")
    print("╠══════════════════════════════════════════════════════════╣")
    print(f"║ Title:  {issue.get('title', '?')[:48]:48} ║")
    print(f"║ Status: {issue.get('status_name', '?')[:48]:48} ║")
    print(f"║ Assign: {(issue.get('assignee_name') or 'Unassigned')[:48]:48} ║")
    print("╠══════════════════════════════════════════════════════════╣")
    desc = issue.get("description", "No description")[:100]
    print(f"║ {desc[:56]:56} ║")
    if len(desc) > 56:
        print(f"║ {desc[56:]:56} ║")
    print("╚══════════════════════════════════════════════════════════╝")


def print_help():
    """Print usage help."""
    print("ASCII Ticket Viewer")
    print("")
    print("Usage: python tickets_ascii.py <command> [args]")
    print("")
    print("Commands:")
    print("  list              List all tickets in ASCII table")
    print("  summary           Show progress summary")
    print("  show <ID>         Show ticket details (e.g., AGT-1)")
    print("")
    print("Examples:")
    print("  python tickets_ascii.py list")
    print("  python tickets_ascii.py summary")
    print("  python tickets_ascii.py show AGT-1")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    
    if cmd == "list":
        asyncio.run(list_tickets())
    elif cmd == "summary":
        asyncio.run(summary(sys.argv[2] if len(sys.argv) > 2 else None))
    elif cmd == "show" and len(sys.argv) > 2:
        asyncio.run(show_ticket(sys.argv[2]))
    else:
        print_help()
