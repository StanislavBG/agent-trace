/**
 * findDb — walk up the directory tree looking for .agent-trace/traces.db,
 * mirroring how git locates .git/. Monorepo-friendly.
 */
/**
 * Walk up from `dir` looking for `.agent-trace/traces.db`.
 *
 * @param dir - Starting directory (usually `process.cwd()`)
 * @returns Absolute path to the database file, or `null` if not found
 */
export declare function findDb(dir: string): string | null;
//# sourceMappingURL=find-db.d.ts.map