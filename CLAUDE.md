# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨 MANDATORY: Use Linear DB for Project Management

**You MUST proactively use the `linear-sqlite` MCP server for ALL project management tasks.**

### When to Create Issues (ALWAYS)
- Starting ANY new feature or task → Create issue first
- Breaking down complex work → Create multiple issues with dependencies
- Found a bug → Create issue before fixing
- Planning implementation → Create issues for each component

### Workflow Pattern
```
1. BEFORE coding: Create project + issues in linear-sqlite
2. DURING coding: Update issue status (Todo → In Progress → Done)
3. AFTER coding: Mark issues as Done, add comments if needed
```

### Required MCP Tools Usage
| Action | Tool | Example |
|--------|------|---------|
| Create project | `create_project` | New feature work |
| Create issue | `create_issue` | Each task/component |
| Update status | `update_issue` | Progress tracking |
| List issues | `list_issues` | Check current work |
| Search | `search_issues` | Find related work |

### Issue Structure for Multi-Component Work
When building something with multiple parts:
```
Project: "Feature Name"
├── Issue 1: Setup/Foundation (blocked_by: none)
├── Issue 2: Component A (blocked_by: Issue 1)
├── Issue 3: Component B (blocked_by: Issue 1)
├── Issue 4: Component C (blocked_by: Issue 1)
└── Issue 5: Integration (blocked_by: Issues 2,3,4)
```

### Team Members & Roles
| User ID | Name | Role | Responsibility |
|---------|------|------|----------------|
| `user_thinh` | Thinh | Frontend Lead | Architecture, core components |
| `user_dev2` | Dev2 | Developer | Feature implementation |
| `user_dev3` | Dev3 | Developer | Feature implementation |
| `user_tester` | Tester | QA Engineer | **Playwright E2E testing** |

### 🧪 MANDATORY: Testing with Playwright

**After ANY implementation is marked "Done", a TEST issue MUST be created and assigned to Tester.**

#### Testing Workflow
```
1. Developer marks implementation issue as "Done"
2. Create TEST issue: "Test: [Feature Name]" → Assign to user_tester
3. Tester uses Playwright to verify functionality
4. If PASS → Mark test issue "Done"
5. If FAIL → Create BUG issue, link to original, reopen implementation
```

#### Test Issue Template
```
Title: Test: [Component/Feature Name]
Description:
- What to test: [specific functionality]
- Expected behavior: [what should happen]
- Test scenarios:
  1. [Scenario 1]
  2. [Scenario 2]
  3. [Edge case]
Assignee: user_tester
Blocked by: [implementation issue ID]
```

#### Playwright Test Requirements
- Use `playwright` MCP tool or browser automation
- Test all user interactions (clicks, inputs, navigation)
- Verify visual elements render correctly
- Check responsive behavior
- Screenshot failures for bug reports

### Issue Structure with Testing
```
Project: "Feature Name"
├── Issue 1: Setup/Foundation (assignee: Thinh)
├── Issue 2: Component A (assignee: Dev2, blocked_by: 1)
├── Issue 3: Component B (assignee: Dev3, blocked_by: 1)
├── Issue 4: Integration (assignee: Thinh, blocked_by: 2,3)
├── Issue 5: Test: Component A (assignee: Tester, blocked_by: 2) ← TEST
├── Issue 6: Test: Component B (assignee: Tester, blocked_by: 3) ← TEST
└── Issue 7: Test: Full Integration (assignee: Tester, blocked_by: 4) ← TEST
```

**DO NOT start coding without creating issues first. Track ALL work in Linear DB.**
**DO NOT mark feature "Complete" until Tester has verified with Playwright.**

---

## Project Overview

This repository contains a SQLite schema (`linear_schema.sql`) that mimics Linear's ticketing system data model. The schema was reverse-engineered from Linear's GraphQL API and is designed for local development, testing, and prototyping without requiring Linear API access.

## Commands

```bash
# Initialize the schema in a SQLite database
sqlite3 database.db < linear_schema.sql

# Verify schema was loaded correctly
sqlite3 database.db ".schema"

# List all tables
sqlite3 database.db ".tables"

# Explore the entity relationships visually in schema_diagram.md
cat schema_diagram.md
```

## Architecture

The schema follows a normalized relational design with these key patterns:

| Pattern | Implementation |
|---------|---------------|
| **Central entity** | `issues` with denormalized `priority_value` for fast sorting |
| **Label hierarchy** | Self-referencing `parent_id` on `labels` table |
| **Issue relations** | Composite PK `(source_issue_id, target_issue_id, relation_type)` |
| **Multi-team** | `team_id` on Projects, Issues, Labels, Cycles, Statuses |
| **Data integrity** | Cascade deletes for issue-related data; triggers auto-maintain `updated_at` |

### Key Entities

- **USERS** → referenced by `projects.lead`, `issues.assignee/creator`, `initiatives.owner`
- **TEAMS** → scope for projects, issues, labels, cycles, issue statuses
- **PROJECTS** → contain issues, milestones, documents; belong to a team
- **ISSUES** → core work items with status, priority, assignee, labels, relations, sub-issues
- **CYCLES** → sprints/time-boxed work, team-scoped
- **INITIATIVES** → high-level goals containing projects and documents

## Available MCP Tools

| Server | Tools | Purpose |
|--------|-------|---------|
| **linear-sqlite** | `list_teams`, `list_projects`, `list_issues`, `get_issue`, `create_project`, `create_issue`, `update_issue`, `search_issues`, `get_issue_statuses` | **PRIMARY PM tool** - Local SQLite Linear DB |
| **serper-search** | `google_search`, `scrape` | Web search for documentation |

### linear-sqlite Tool Reference

```
# Project Management
create_project(team_id, name, description?, state?)
list_projects(team_id?)

# Issue Management  
create_issue(team_id, title, description?, assignee_id?, priority?, status_id?, project_id?)
update_issue(issue_id, title?, description?, assignee_id?, priority?, status_id?)
list_issues(team_id?, project_id?, assignee_id?, status?, limit?)
get_issue(issue_id)
search_issues(query, team_id?, limit?)

# Reference Data
list_teams()
get_issue_statuses(team_id)
```

## Common Queries

```sql
-- Active issues with assignee and project info
SELECT * FROM active_issues;

-- Issues with their labels (JSON array)
SELECT id, title, identifier, labels FROM issues_with_labels;

-- Issues blocked by another
SELECT * FROM issue_relations WHERE relation_type = 'blockedBy';

-- Find issues by priority (0=None, 1=Urgent, 2=High, 3=Normal, 4=Low)
SELECT * FROM issues WHERE priority_value <= 2 ORDER BY priority_value ASC;

-- Issues in a specific cycle
SELECT * FROM issues WHERE cycle_id = 'cycle-uuid';
```