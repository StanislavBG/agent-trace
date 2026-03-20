/**
 * agent-trace trace <traceId> — show all spans in a trace as a tree.
 */
export interface TraceOptions {
    db: string;
    json?: boolean;
}
export declare function runTrace(traceId: string, opts: TraceOptions): void;
//# sourceMappingURL=trace.d.ts.map