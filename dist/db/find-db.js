/**
 * findDb — walk up the directory tree looking for .agent-trace/traces.db,
 * mirroring how git locates .git/. Monorepo-friendly.
 */
import path from 'path';
import fs from 'fs';
/**
 * Walk up from `dir` looking for `.agent-trace/traces.db`.
 *
 * @param dir - Starting directory (usually `process.cwd()`)
 * @returns Absolute path to the database file, or `null` if not found
 */
export function findDb(dir) {
    const candidate = path.join(dir, '.agent-trace', 'traces.db');
    if (fs.existsSync(candidate))
        return candidate;
    const parent = path.dirname(dir);
    if (parent === dir)
        return null; // filesystem root
    return findDb(parent);
}
//# sourceMappingURL=find-db.js.map