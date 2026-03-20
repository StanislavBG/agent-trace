/**
 * agent-trace traces — list recent traces grouped by trace_id.
 */
import { Command } from 'commander';
import type { SpanRecord } from '../schema.js';
export declare function formatDuration(ms: number): string;
interface TraceGroup {
    traceId: string;
    spanCount: number;
    totalDurationMs: number;
    firstStartTime: number;
    firstCreatedAt: string;
    rootCommand?: string;
}
export declare function groupByTrace(spans: SpanRecord[]): TraceGroup[];
export declare const tracesCommand: Command;
export {};
//# sourceMappingURL=traces.d.ts.map