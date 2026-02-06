import { query, getOne, run } from "../db.js";
import { success, error, getTeamId, getUserId, getProjectId, getIssueId, getLabelId, generateIssueIdentifier, PRIORITY_MAP } from "./base.js";
// Tool definitions
export function getIssueTools() {
    return [
        {
            name: "list_issues",
            description: "List issues with optional filtering",
            inputSchema: {
                type: "object",
                properties: {
                    team: { type: "string", description: "Team name, key, or ID" },
                    project: { type: "string", description: "Project name or ID" },
                    assignee: { type: "string", description: "User ID, name, email, or 'me'" },
                    state: { type: "string", description: "State type or name" },
                    label: { type: "string", description: "Label name or ID" },
                    query: { type: "string", description: "Search in title/description" },
                    orderBy: { type: "string", enum: ["createdAt", "updatedAt"] },
                    limit: { type: "number" },
                    includeArchived: { type: "boolean" },
                },
            },
        },
        {
            name: "get_issue",
            description: "Get a single issue by ID or identifier",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Issue ID or identifier (e.g., ENG-123)" },
                    includeRelations: { type: "boolean", description: "Include blocking/related relations" },
                },
                required: ["id"],
            },
        },
        {
            name: "create_issue",
            description: "Create a new issue",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Issue title" },
                    team: { type: "string", description: "Team name or ID (required)" },
                    description: { type: "string", description: "Issue description (Markdown)" },
                    project: { type: "string", description: "Project name or ID" },
                    assignee: { type: "string", description: "User ID, name, email, or 'me'" },
                    priority: { type: "number", description: "Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low" },
                    state: { type: "string", description: "State name" },
                    labels: { type: "array", items: { type: "string" } },
                    estimate: { type: "number", description: "Story points" },
                    due_date: { type: "string", description: "Due date (ISO format)" },
                    blocks: { type: "array", items: { type: "string" }, description: "Issue IDs this blocks" },
                    blocked_by: { type: "array", items: { type: "string" }, description: "Issue IDs blocking this" },
                    related_to: { type: "array", items: { type: "string" }, description: "Related issue IDs" },
                },
                required: ["title", "team"],
            },
        },
        {
            name: "update_issue",
            description: "Update an existing issue",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Issue ID or identifier" },
                    title: { type: "string", description: "New title" },
                    description: { type: "string", description: "New description" },
                    assignee: { type: "string", description: "User ID, name, email, 'me', or null to remove" },
                    priority: { type: "number", description: "Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low" },
                    state: { type: "string", description: "State name or ID" },
                    labels: { type: "array", items: { type: "string" }, description: "New label list" },
                    estimate: { type: "number", description: "Story points" },
                    due_date: { type: "string", description: "Due date (ISO format)" },
                },
                required: ["id"],
            },
        },
    ];
}
// Handler registration
export function registerIssueTools(registerHandler) {
    // list_issues
    registerHandler("list_issues", async (args) => {
        let sql = `SELECT i.*, u.name as assignee_name, p.name as project_name, t.name as team_name,
               s.name as status_name, s.type as status_type
               FROM issues i
               LEFT JOIN users u ON i.assignee_id = u.id
               LEFT JOIN projects p ON i.project_id = p.id
               LEFT JOIN teams t ON i.team_id = t.id
               LEFT JOIN issue_statuses s ON i.status_id = s.id
               WHERE 1=1`;
        const params = [];
        if (args.team) {
            const teamId = await getTeamId(args.team);
            if (teamId) {
                sql += ` AND i.team_id = ?`;
                params.push(teamId);
            }
        }
        if (args.project) {
            const projectId = await getProjectId(args.project);
            if (projectId) {
                sql += ` AND i.project_id = ?`;
                params.push(projectId);
            }
        }
        if (args.assignee) {
            const userId = await getUserId(args.assignee);
            if (userId) {
                sql += ` AND i.assignee_id = ?`;
                params.push(userId);
            }
        }
        if (args.state) {
            sql += ` AND (s.id = ? OR s.name = ? OR s.type = ?)`;
            params.push(args.state, args.state, args.state);
        }
        if (args.label) {
            const labelId = await getLabelId(args.label);
            if (labelId) {
                sql += ` AND i.id IN (SELECT issue_id FROM issue_labels WHERE label_id = ?)`;
                params.push(labelId);
            }
        }
        if (args.query) {
            sql += ` AND (i.title LIKE ? OR i.description LIKE ?)`;
            params.push(`%${args.query}%`, `%${args.query}%`);
        }
        if (!args.includeArchived) {
            sql += ` AND i.archived_at IS NULL`;
        }
        const orderBy = args.orderBy === 'createdAt' ? 'i.created_at' : 'i.updated_at';
        sql += ` ORDER BY ${orderBy} DESC`;
        if (args.limit) {
            sql += ` LIMIT ?`;
            params.push(args.limit);
        }
        return success(await query(sql, params));
    });
    // get_issue
    registerHandler("get_issue", async (args) => {
        const issueId = await getIssueId(args.id);
        if (!issueId)
            return error("Issue not found");
        const issue = await getOne(`SELECT i.*, u.name as assignee_name, p.name as project_name, t.name as team_name,
                                      s.name as status_name, s.type as status_type
                                      FROM issues i
                                      LEFT JOIN users u ON i.assignee_id = u.id
                                      LEFT JOIN projects p ON i.project_id = p.id
                                      LEFT JOIN teams t ON i.team_id = t.id
                                      LEFT JOIN issue_statuses s ON i.status_id = s.id
                                      WHERE i.id = ?`, [issueId]);
        if (!issue)
            return error("Issue not found");
        issue.labels = await query(`SELECT l.* FROM labels l JOIN issue_labels il ON l.id = il.label_id WHERE il.issue_id = ?`, [issueId]);
        issue.comments = await query(`SELECT c.*, u.name as user_name FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.issue_id = ? ORDER BY c.created_at ASC`, [issueId]);
        if (args.includeRelations) {
            issue.blocks = await query(`SELECT i.* FROM issues i JOIN issue_relations ir ON i.id = ir.target_issue_id WHERE ir.source_issue_id = ? AND ir.relation_type = 'blocks'`, [issueId]);
            issue.blocked_by = await query(`SELECT i.* FROM issues i JOIN issue_relations ir ON i.id = ir.source_issue_id WHERE ir.target_issue_id = ? AND ir.relation_type = 'blocks'`, [issueId]);
            issue.related = await query(`SELECT i.* FROM issues i JOIN issue_relations ir ON i.id = ir.target_issue_id WHERE ir.source_issue_id = ? AND ir.relation_type = 'related'`, [issueId]);
        }
        return success(issue);
    });
    // create_issue
    registerHandler("create_issue", async (args) => {
        const teamId = await getTeamId(args.team);
        if (!teamId)
            return error(`Team '${args.team}' not found`);
        const id = `issue_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const identifier = await generateIssueIdentifier(teamId);
        const now = new Date().toISOString();
        const creator = await getOne(`SELECT id FROM users LIMIT 1`);
        const creatorId = creator?.id || null;
        let statusId = null;
        if (args.state) {
            const status = await getOne(`SELECT id FROM issue_statuses WHERE team_id = ? AND (name = ? OR type = ?)`, [teamId, args.state, args.state]);
            statusId = status?.id || null;
        }
        const priorityId = (args.priority && args.priority > 0) ? (PRIORITY_MAP[args.priority] || 'prio_normal') : null;
        const projectId = args.project ? await getProjectId(args.project, teamId) : null;
        const assigneeId = args.assignee ? await getUserId(args.assignee) : null;
        await run(`INSERT INTO issues (id, identifier, title, description, priority_id, priority_value, status_id, project_id, team_id, assignee_id, creator_id, due_date, estimate, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, identifier, args.title, args.description || null, priorityId, args.priority || 3, statusId, projectId, teamId, assigneeId, creatorId, args.due_date || null, args.estimate || null, now, now]);
        if (args.labels) {
            for (const label of args.labels) {
                const labelId = await getLabelId(label, teamId);
                if (labelId)
                    await run(`INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?)`, [id, labelId]);
            }
        }
        if (args.blocks) {
            for (const blockedId of args.blocks) {
                const targetId = await getIssueId(blockedId);
                if (targetId)
                    await run(`INSERT INTO issue_relations (source_issue_id, target_issue_id, relation_type) VALUES (?, ?, 'blocks')`, [id, targetId]);
            }
        }
        if (args.blocked_by) {
            for (const blockerId of args.blocked_by) {
                const sourceId = await getIssueId(blockerId);
                if (sourceId)
                    await run(`INSERT INTO issue_relations (source_issue_id, target_issue_id, relation_type) VALUES (?, ?, 'blocks')`, [sourceId, id]);
            }
        }
        if (args.related_to) {
            for (const relatedId of args.related_to) {
                const targetId = await getIssueId(relatedId);
                if (targetId)
                    await run(`INSERT INTO issue_relations (source_issue_id, target_issue_id, relation_type) VALUES (?, ?, 'related')`, [id, targetId]);
            }
        }
        return success({ id, identifier, ...args });
    });
    // update_issue
    registerHandler("update_issue", async (args) => {
        const issueId = await getIssueId(args.id);
        if (!issueId)
            return error("Issue not found");
        const updates = [];
        const params = [];
        if (args.title !== undefined) {
            updates.push('title = ?');
            params.push(args.title);
        }
        if (args.description !== undefined) {
            updates.push('description = ?');
            params.push(args.description);
        }
        if (args.priority !== undefined) {
            updates.push('priority_value = ?', 'priority_id = ?');
            params.push(args.priority, args.priority > 0 ? (PRIORITY_MAP[args.priority] || 'prio_normal') : null);
        }
        if (args.estimate !== undefined) {
            updates.push('estimate = ?');
            params.push(args.estimate);
        }
        if (args.due_date !== undefined) {
            updates.push('due_date = ?');
            params.push(args.due_date);
        }
        if (args.state !== undefined) {
            const issue = await getOne(`SELECT team_id FROM issues WHERE id = ?`, [issueId]);
            if (issue?.team_id) {
                // Search team-specific statuses first, then global statuses (team_id IS NULL)
                const status = await getOne(`SELECT id FROM issue_statuses WHERE (team_id = ? OR team_id IS NULL) AND (name = ? OR id = ? OR type = ?) ORDER BY team_id DESC NULLS LAST`, [issue.team_id, args.state, args.state, args.state]);
                if (status) {
                    updates.push('status_id = ?');
                    params.push(status.id);
                }
            }
        }
        if (args.assignee !== undefined) {
            const userId = args.assignee === null ? null : await getUserId(args.assignee);
            updates.push('assignee_id = ?');
            params.push(userId);
        }
        // Handle labels separately (not part of main issues table update)
        let labelsUpdated = false;
        if (args.labels !== undefined) {
            await run(`DELETE FROM issue_labels WHERE issue_id = ?`, [issueId]);
            const issue = await getOne(`SELECT team_id FROM issues WHERE id = ?`, [issueId]);
            for (const label of args.labels) {
                const labelId = await getLabelId(label, issue?.team_id);
                if (labelId)
                    await run(`INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?)`, [issueId, labelId]);
            }
            labelsUpdated = true;
        }
        if (updates.length === 0 && !labelsUpdated)
            return success({ message: "No updates provided" });
        if (updates.length > 0) {
            updates.push('updated_at = ?');
            params.push(new Date().toISOString());
            params.push(issueId);
            await run(`UPDATE issues SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        return success({ id: issueId, message: "Issue updated" });
    });
}
//# sourceMappingURL=issues.js.map