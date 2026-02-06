import { success, getTeamId } from "./base.js";
import { query, getOne, run } from "../db.js";
export function getCycleTools() {
    return [
        {
            name: "list_cycles",
            description: "List cycles for a team",
            inputSchema: { type: "object", properties: { team: { type: "string", description: "Team name, key, or ID" }, type: { type: "string", enum: ["current", "previous", "next"] } }, required: ["team"] },
        },
        {
            name: "get_cycle",
            description: "Get a cycle by id",
            inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
        {
            name: "create_cycle",
            description: "Create a new cycle",
            inputSchema: {
                type: "object",
                properties: { team: { type: "string" }, name: { type: "string" }, description: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } },
                required: ["team", "name", "startDate", "endDate"],
            },
        },
        {
            name: "update_cycle",
            description: "Update a cycle",
            inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["id"] },
        },
        {
            name: "delete_cycle",
            description: "Delete a cycle",
            inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
    ];
}
export function registerCycleTools(registerHandler) {
    registerHandler("list_cycles", async (args) => {
        const teamId = await getTeamId(args.team);
        if (!teamId)
            return { success: false, error: "Team not found" };
        let sql = "SELECT * FROM cycles WHERE team_id = ?";
        const params = [teamId];
        if (args.type === "current")
            sql += " AND status = 'current'";
        else if (args.type === "previous")
            sql += " AND status = 'previous'";
        else if (args.type === "next")
            sql += " AND status = 'next'";
        sql += " ORDER BY start_date DESC";
        return success(await query(sql, params));
    });
    registerHandler("get_cycle", async (args) => {
        const cycle = await getOne("SELECT * FROM cycles WHERE id = ?", [args.id]);
        if (!cycle)
            return { success: false, error: "Cycle not found" };
        return success(cycle);
    });
    registerHandler("create_cycle", async (args) => {
        const teamId = await getTeamId(args.team);
        if (!teamId)
            return { success: false, error: "Team not found" };
        const id = `cycle_${Date.now()}`;
        await run("INSERT INTO cycles (id, name, description, status, start_date, end_date, team_id, created_at) VALUES (?, ?, ?, 'upcoming', ?, ?, ?, datetime('now'))", [id, args.name, args.description || null, args.startDate, args.endDate, teamId]);
        return success(await getOne("SELECT * FROM cycles WHERE id = ?", [id]));
    });
    registerHandler("update_cycle", async (args) => {
        const cycle = await getOne("SELECT * FROM cycles WHERE id = ?", [args.id]);
        if (!cycle)
            return { success: false, error: "Cycle not found" };
        const updates = [];
        const params = [];
        if (args.name !== undefined) {
            updates.push("name = ?");
            params.push(args.name);
        }
        if (args.description !== undefined) {
            updates.push("description = ?");
            params.push(args.description);
        }
        if (args.status !== undefined) {
            updates.push("status = ?");
            params.push(args.status);
        }
        if (args.startDate !== undefined) {
            updates.push("start_date = ?");
            params.push(args.startDate);
        }
        if (args.endDate !== undefined) {
            updates.push("end_date = ?");
            params.push(args.endDate);
        }
        if (updates.length > 0) {
            params.push(args.id);
            await run(`UPDATE cycles SET ${updates.join(", ")} WHERE id = ?`, params);
        }
        return success(await getOne("SELECT * FROM cycles WHERE id = ?", [args.id]));
    });
    registerHandler("delete_cycle", async (args) => {
        await run("DELETE FROM cycles WHERE id = ?", [args.id]);
        return success({ deleted: true });
    });
}
//# sourceMappingURL=cycles.js.map