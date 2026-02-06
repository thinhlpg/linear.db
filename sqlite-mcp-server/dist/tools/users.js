import { query, getOne, run } from "../db.js";
import { success, error } from "./base.js";
export function getUserTools() {
    return [
        {
            name: "list_users",
            description: "List all users",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Filter by name or email" },
                    limit: { type: "number" },
                },
            },
        },
        {
            name: "get_user",
            description: "Get a user by ID, name, email, or 'me'",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "User ID, name, email, or 'me'" },
                },
                required: ["query"],
            },
        },
        {
            name: "create_user",
            description: "Create a new user",
            inputSchema: {
                type: "object",
                properties: {
                    name: { type: "string", description: "User's display name" },
                    email: { type: "string", description: "User's email address" },
                    avatarUrl: { type: "string", description: "URL to user's avatar image" },
                },
                required: ["name", "email"],
            },
        },
    ];
}
export function registerUserTools(registerHandler) {
    registerHandler("list_users", async (args) => {
        let sql = "SELECT * FROM users WHERE 1=1";
        const params = [];
        if (args.query) {
            sql += " AND (name LIKE ? OR email LIKE ?)";
            params.push(`%${args.query}%`, `%${args.query}%`);
        }
        sql += " ORDER BY name ASC";
        if (args.limit) {
            sql += " LIMIT ?";
            params.push(args.limit);
        }
        return success(await query(sql, params));
    });
    registerHandler("get_user", async (args) => {
        if (args.query === 'me') {
            const user = await getOne("SELECT * FROM users LIMIT 1");
            if (!user)
                return error("No users found");
            return success(user);
        }
        const user = await getOne("SELECT * FROM users WHERE id = ? OR name = ? OR email = ?", [args.query, args.query, args.query]);
        if (!user)
            return error("User not found");
        return success(user);
    });
    registerHandler("create_user", async (args) => {
        // Check if email already exists
        const existing = await getOne(`SELECT id FROM users WHERE email = ?`, [args.email]);
        if (existing)
            return error(`User with email '${args.email}' already exists`);
        // Generate ID from name (lowercase, replace spaces with underscore)
        const id = `user_${args.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;
        const now = new Date().toISOString();
        await run(`INSERT INTO users (id, name, email, avatar_url, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`, [id, args.name, args.email, args.avatarUrl || null, now, now]);
        return success({ id, name: args.name, email: args.email });
    });
}
//# sourceMappingURL=users.js.map