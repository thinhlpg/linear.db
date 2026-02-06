import { query, getOne } from "../db.js";
export function success(data) {
    return { success: true, data };
}
export function error(message) {
    return { success: false, error: message };
}
export async function getTeamId(team) {
    if (!team)
        return null;
    const result = await getOne(`SELECT id FROM teams WHERE id = ? OR name = ? OR key = ?`, [team, team, team]);
    return result?.id || null;
}
export async function getUserId(user) {
    if (!user)
        return null;
    if (user === 'me') {
        const me = await getOne(`SELECT id FROM users LIMIT 1`);
        return me?.id || null;
    }
    const result = await getOne(`SELECT id FROM users WHERE id = ? OR email = ? OR name = ?`, [user, user, user]);
    return result?.id || null;
}
export async function getProjectId(project, teamId) {
    if (!project)
        return null;
    let sql = `SELECT id FROM projects WHERE id = ? OR name = ?`;
    const params = [project, project];
    if (teamId) {
        sql += ` AND team_id = ?`;
        params.push(teamId);
    }
    const result = await getOne(sql, params);
    return result?.id || null;
}
export async function getIssueId(issue) {
    if (!issue)
        return null;
    const result = await getOne(`SELECT id FROM issues WHERE id = ? OR identifier = ?`, [issue, issue]);
    return result?.id || null;
}
export async function getLabelId(label, teamId) {
    if (!label)
        return null;
    let sql = `SELECT id FROM labels WHERE id = ? OR name = ?`;
    const params = [label, label];
    if (teamId) {
        sql += ` AND (team_id = ? OR team_id IS NULL)`;
        params.push(teamId);
    }
    const result = await getOne(sql, params);
    return result?.id || null;
}
export async function generateIssueIdentifier(teamId) {
    const team = await getOne(`SELECT key FROM teams WHERE id = ?`, [teamId]);
    const key = team?.key || 'ISS';
    const count = await query(`SELECT COUNT(*) as cnt FROM issues WHERE team_id = ?`, [teamId]);
    const num = (count[0]?.cnt || 0) + 1;
    return `${key}-${num}`;
}
const PRIORITY_MAP = {
    0: 'prio_none', 1: 'prio_urgent', 2: 'prio_high', 3: 'prio_normal', 4: 'prio_low',
};
export { PRIORITY_MAP };
//# sourceMappingURL=base.js.map