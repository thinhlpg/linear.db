# Jan Agentic PM Demo

Multi-agent orchestration with a live dashboard, using Linear DB as the coordination layer.

## Features

- **Multi-Agent System**: Alan (PM) creates tasks, Workers execute them
- **Live Dashboard**: Real-time activity feed with Jan identity styling
- **Gantt Chart**: Timeline view with dependency visualization
- **Dependency Graph**: See which tasks block others and what can run in parallel

## Quick Start

### 1. Start Linear DB MCP Server

```bash
cd ../sqlite-mcp-server
npm install && npm run init-db
PORT=3335 npm run dev
```

### 2. Start Dashboard

```bash
cd agentic-pm
bash run.sh dashboard
# Open http://localhost:8888
```

### 3. Run Agents

```bash
# Alan: Create tasks from PRD
bash run.sh alan "Build a bouncing ball HTML file" worker1@local

# Worker: Execute assigned tasks  
bash run.sh worker worker1@local --dir ./workspace
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  ALAN (PM Agent)                                                │
│  • Analyzes PRDs using Claude                                   │
│  • Creates minimal, atomic tasks with dependencies              │
│  • Assigns to workers (round-robin)                             │
└─────────────────────────────┬───────────────────────────────────┘
                              │ creates issues
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LINEAR DB (../sqlite-mcp-server)                               │
│  • Single source of truth for tasks                             │
│  • Status: Backlog → In Progress → Done                         │
│  • Supports blocking relationships (blocks/blocked_by)          │
└──────────────┬──────────────────────────────────┬───────────────┘
               │ polls for tasks                  │ API
               ▼                                  ▼
┌──────────────────────────────┐  ┌───────────────────────────────┐
│  WORKER (Developer Agent)    │  │  DASHBOARD (FastAPI)          │
│  • Polls for assigned tasks  │  │  • Live activity feed (SSE)   │
│  • Executes via Claude SDK   │  │  • Gantt chart timeline       │
│  • Updates status + comments │  │  • Dependency visualization   │
└──────────────────────────────┘  └───────────────────────────────┘
```

## Components

| Component | File | Purpose |
|-----------|------|---------|
| Alan | `alan.py` | PM agent - PRD → tasks |
| Worker | `worker.py` | Developer agent - executes tasks |
| Dashboard | `dashboard.py` | Live UI with activity feed + Gantt |
| Linear Client | `linear_client.py` | HTTP client for Linear DB MCP |
| Config | `config.py` | Environment configuration |

## Dashboard

Access at `http://localhost:8888` after running `bash run.sh dashboard`.

### Activity Feed (`/`)
- Real-time SSE updates when issues are created or status changes
- Shows connected status, total/in-progress/done counts

### Gantt Chart (`/gantt`)
- **Timeline View**: Issues as bars, color-coded by status
- **Dependency Graph**: Visual DAG showing blocking relationships
- **Parallel Tasks**: Highlighted tasks that can run simultaneously

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LINEAR_DB_URL` | `http://localhost:3335/mcp` | Linear DB MCP endpoint |
| `TEAM_KEY` | `AGT` | Team identifier |
| `POLL_INTERVAL` | `5` | Worker polling interval (seconds) |
| `CLAUDE_MODEL` | `sonnet` | Claude model for workers |

## Example Workflow

```bash
# Terminal 1: Linear DB
cd ../sqlite-mcp-server && PORT=3335 npm run dev

# Terminal 2: Dashboard
cd ../agentic-pm && bash run.sh dashboard

# Terminal 3: Alan creates tasks
bash run.sh alan "Build HTML Flappy Bird with bird, pipes, score" worker1@local

# Terminal 4: Worker executes
bash run.sh worker worker1@local --dir ./workspace

# Watch the dashboard update in real-time!
```
