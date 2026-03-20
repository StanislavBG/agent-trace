/**
 * agent-trace record <command> — wrap a shell command with OTel GenAI tracing.
 *
 * Spawns the command, opens an OTel span for its lifetime, stores to SQLite.
 * Finds or creates .agent-trace/traces.db walking up from cwd.
 */
import { Command } from 'commander';
export declare const recordCommand: Command;
//# sourceMappingURL=record.d.ts.map