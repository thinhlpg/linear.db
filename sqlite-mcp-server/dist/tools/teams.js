import { query, getOne, run } from "../db.js";
import { success, error } from "./base.js";
export function getTeamTools() {
    return [
        {
            name: "list_teams",
            description: "List all teams",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" },
                    limit: { type: "number" },
                    includeArchived: { type: "boolean" },
                },
            },
        },
        {
            name: "get_team",
            description: "Get a team by ID, key, or name",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Team UUID, key, or name" },
                },
                required: ["query"],
            },
        },
        {
            name: "create_team",
            description: "Create a new team",
            inputSchema: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Team name" },
                    key: { type: "string", description: "Team key (2-5 uppercase letters, e.g., ENG)" },
                    color: { type: "string", description: "Team color (hex, e.g., #5e6ad2)" },
                    icon: { type: "string", description: "Team icon" },
                },
                required: ["name", "key"],
            },
        },
        {
            name: "list_issue_statuses",
            description: "List available issue statuses in a team",
            inputSchema: {
                type: "object",
                properties: {
                    team: { type: "string", description: "Team name, key, or ID (required)" },
                },
                required: ["team"],
            },
        },
    ];
}
export function registerTeamTools(registerHandler) {
    registerHandler("list_teams", async (args) => {
        let sql = `SELECT * FROM teams WHERE name IS NOT NULL`;
        const params = [];
        if (args.query) {
            sql += ` AND (name LIKE ? OR key LIKE ?)`;
            params.push(`%${args.query}%`, `%${args.query}%`);
        }
        sql += ` ORDER BY updated_at DESC`;
        if (args.limit) {
            sql += ` LIMIT ?`;
            params.push(args.limit);
        }
        return success(await query(sql, params));
    });
    registerHandler("get_team", async (args) => {
        const team = await getOne(`SELECT * FROM teams WHERE id = ? OR key = ? OR name = ?`, [args.query, args.query, args.query]);
        if (!team)
            return error("Team not found");
        return success(team);
    });
    registerHandler("create_team", async (args) => {
        // Validate key format (2-5 uppercase letters)
        if (!/^[A-Z]{2,5}$/.test(args.key)) {
            return error("Team key must be 2-5 uppercase letters (e.g., ENG, PROD)");
        }
        // Check if key already exists
        const existing = await getOne(`SELECT id FROM teams WHERE key = ?`, [args.key]);
        if (existing)
            return error(`Team with key '${args.key}' already exists`);
        const id = `team_${args.key.toLowerCase()}`;
        const now = new Date().toISOString();
        await run(`INSERT INTO teams (id, name, key, color, icon, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, args.name, args.key, args.color || '#5e6ad2', args.icon || null, now, now]);
        return success({ id, name: args.name, key: args.key });
    });
    registerHandler("list_issue_statuses", async (args) => {
        const team = await getOne(`SELECT id FROM teams WHERE id = ? OR key = ? OR name = ?`, [args.team, args.team, args.team]);
        if (!team)
            return error("Team not found");
        // Include both team-specific statuses and global statuses (team_id IS NULL)
        return success(await query(`SELECT * FROM issue_statuses WHERE team_id = ? OR team_id IS NULL ORDER BY id ASC`, [team.id]));
    });
}
//# sourceMappingURL=teams.js.map