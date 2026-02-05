#!/bin/bash
# Agentic PM - Multi-agent orchestration using Linear DB
# Usage: bash run.sh [command] [args...]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create venv if needed
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    uv venv .venv
fi

# Install deps
echo "Installing dependencies..."
uv pip install -r requirements.txt -q

# Activate venv
source .venv/bin/activate

# Commands
case "${1:-help}" in
    alan)
        # Alan: Break down PRD into tasks
        # Usage: bash run.sh alan "PRD text" [worker1@email,worker2@email]
        shift
        python alan.py "$@"
        ;;
    
    worker)
        # Worker: Execute assigned tasks
        # Usage: bash run.sh worker worker@email [--loop] [--dir /path]
        shift
        python worker.py "$@"
        ;;
    
    dashboard)
        # Dashboard: Real-time activity feed
        # Usage: bash run.sh dashboard [--port 8888]
        PORT="${2:-8888}"
        echo "=== Jan Agentic PM Dashboard ==="
        echo "Starting on http://localhost:$PORT"
        echo ""
        python -m uvicorn dashboard:app --host 0.0.0.0 --port "$PORT" --reload
        ;;
    
    demo)
        # Run a demo: Alan creates tasks, workers execute
        echo "=== Agentic PM Demo ==="
        echo ""
        echo "Step 1: Alan creates tasks from PRD..."
        python alan.py "Build a simple CLI calculator in Python. Features: add, subtract, multiply, divide. Include tests and documentation." "worker1@local,worker2@local"
        echo ""
        echo "Step 2: Check Linear DB for created tasks..."
        echo "Open http://localhost:3335 or use Linear DB MCP to view tasks"
        echo ""
        echo "Step 3: Run workers to execute tasks:"
        echo "  Terminal 1: bash run.sh worker worker1@local --loop"
        echo "  Terminal 2: bash run.sh worker worker2@local --loop"
        ;;
    
    help|*)
        echo "Agentic PM - Multi-agent orchestration using Linear DB"
        echo ""
        echo "Usage: bash run.sh <command> [args...]"
        echo ""
        echo "Commands:"
        echo "  alan <prd> [workers]    Alan breaks down PRD into tasks"
        echo "  worker <email> [opts]   Worker executes assigned tasks"
        echo "  dashboard [--port N]    Live activity feed (default: 8888)"
        echo "  demo                    Run demo workflow"
        echo ""
        echo "Examples:"
        echo "  bash run.sh alan 'Build a REST API' worker1@local,worker2@local"
        echo "  bash run.sh worker worker1@local --loop"
        echo "  bash run.sh worker worker1@local --dir /path/to/workspace"
        echo "  bash run.sh dashboard"
        echo ""
        echo "Prerequisites:"
        echo "  1. Linear DB MCP server running: cd sqlite-mcp-server && PORT=3335 npm run dev"
        echo "  2. ANTHROPIC_API_KEY set"
        ;;
esac
