import { success, getTeamId } from "./base.js";
import { query, getOne, run } from "../db.js";
export function getLabelTools() {
    return [
        {
            name: "list_issue_labels",
            description: "List all issue labels",
            inputSchema: { type: "object", properties: { team: { type: "string" }, name: { type: "string" }, limit: { type: "number" } } },
        },
        {
            name: "create_issue_label",
            description: "Create a new label",
            inputSchema: {
                type: "object",
                properties: { name: { type: "string" }, team: { type: "string" }, color: { type: "string" }, description: { type: "string" } },
                required: ["name"],
            },
        },
        {
            name: "update_issue_label",
            description: "Update a label",
            inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, color: { type: "string" } }, required: ["id"] },
        },
        {
            name: "delete_issue_label",
            description: "Delete a label",
            inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
    ];
}
export function registerLabelTools(registerHandler) {
    registerHandler("list_issue_labels", async (args) => {
        let sql = "SELECT * FROM labels WHERE 1=1";
        const params = [];
        if (args.team) {
            const teamId = await getTeamId(args.team);
            if (teamId) {
                sql += " AND (team_id = ? OR team_id IS NULL)";
                params.push(teamId);
            }
        }
        if (args.name) {
            sql += " AND name LIKE ?";
            params.push(`%${args.name}%`);
        }
        sql += " ORDER BY name LIMIT ?";
        params.push(args.limit || 50);
        return success(await query(sql, params));
    });
    registerHandler("create_issue_label", async (args) => {
        const teamId = args.team ? await getTeamId(args.team) : null;
        const id = `label_${Date.now()}`;
        await run("INSERT INTO labels (id, name, color, description, team_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", [id, args.name, args.color || "#bec2c8", args.description || null, teamId]);
        return success(await getOne("SELECT * FROM labels WHERE id = ?", [id]));
    });
    registerHandler("update_issue_label", async (args) => {
        const label = await getOne("SELECT * FROM labels WHERE id = ?", [args.id]);
        if (!label)
            return { success: false, error: "Label not found" };
        const updates = [];
        const params = [];
        if (args.name !== undefined) {
            updates.push("name = ?");
            params.push(args.name);
        }
        if (args.color !== undefined) {
            updates.push("color = ?");
            params.push(args.color);
        }
        if (updates.length > 0) {
            params.push(args.id);
            await run(`UPDATE labels SET ${updates.join(", ")} WHERE id = ?`, params);
        }
        return success(await getOne("SELECT * FROM labels WHERE id = ?", [args.id]));
    });
    registerHandler("delete_issue_label", async (args) => {
        await run("DELETE FROM labels WHERE id = ?", [args.id]);
        return success({ deleted: true });
    });
}
//# sourceMappingURL=labels.js.map