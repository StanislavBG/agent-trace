/**
 * agent-trace show <traceId> — display span tree for a trace (prefix match OK).
 */
import { Command } from 'commander';
import { TraceReader } from '../db/reader.js';
import type { SpanRecord } from '../schema.js';
export declare function buildTree(spans: SpanRecord[]): Map<string | null, SpanRecord[]>;
/** Find the full traceId from a prefix */
export declare function resolveTraceId(reader: TraceReader, prefix: string): string | null;
export declare const showCommand: Command;
//# sourceMappingURL=show.d.ts.map