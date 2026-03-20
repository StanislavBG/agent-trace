/**
 * agent-trace show <traceId> — display span tree for a trace (prefix match OK).
 */
import { Command } from 'commander';
import type { SpanRecord } from '../schema.js';
export declare function buildTree(spans: SpanRecord[]): Map<string | null, SpanRecord[]>;
export declare const showCommand: Command;
//# sourceMappingURL=show.d.ts.map