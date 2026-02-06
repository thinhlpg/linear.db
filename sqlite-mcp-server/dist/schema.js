import { getDb } from './db.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'linear.db');
// Parse SQL - handle triggers with BEGIN...END; blocks correctly
function parseStatements(sql) {
    const statements = [];
    let i = 0;
    while (i < sql.length) {
        // Skip leading whitespace
        while (i < sql.length && /\s/.test(sql[i]))
            i++;
        if (i >= sql.length)
            break;
        // Skip comment lines
        if (sql.substring(i).startsWith('--')) {
            const nl = sql.indexOf('\n', i);
            if (nl === -1)
                break;
            i = nl + 1;
            continue;
        }
        let stmt = '';
        // Check if this is a trigger
        if (sql.substring(i).toUpperCase().startsWith('CREATE TRIGGER')) {
            // Build up the trigger statement until we hit END;
            while (i < sql.length) {
                stmt += sql[i];
                if (sql.substring(i).startsWith('END;')) {
                    i += 4; // Skip "END;" but include it in stmt
                    break;
                }
                i++;
            }
        }
        else {
            // Normal statement - end at semicolon
            while (i < sql.length && sql[i] !== ';') {
                stmt += sql[i];
                i++;
            }
            if (i < sql.length && sql[i] === ';') {
                stmt += ';';
                i++;
            }
        }
        stmt = stmt.trim();
        if (stmt && !stmt.startsWith('--') && stmt !== 'END;') {
            statements.push(stmt);
        }
    }
    return statements;
}
export function initializeDatabase() {
    const db = getDb();
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    // Read schema file from parent directory
    const schemaPath = path.join(__dirname, '..', '..', 'linear_schema.sql');
    const schemaSql = readFileSync(schemaPath, 'utf-8');
    // Parse statements properly, handling triggers with BEGIN...END blocks
    const statements = parseStatements(schemaSql);
    for (const statement of statements) {
        try {
            db.exec(statement);
        }
        catch (e) {
            // Ignore errors for existing tables/indices
        }
    }
}
export function getDbPath() {
    return DB_PATH;
}
//# sourceMappingURL=schema.js.map