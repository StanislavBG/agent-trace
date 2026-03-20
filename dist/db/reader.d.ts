/**
 * TraceReader — query stored spans from SQLite.
 */
import { type SpanRecord } from '../schema.js';
export interface QueryOptions {
    limit?: number;
    traceId?: string;
    name?: string;
    since?: string;
}
export declare class TraceReader {
    private db;
    constructor(dbPath: string);
    query(opts?: QueryOptions): SpanRecord[];
    getTrace(traceId: string): SpanRecord[];
    count(): number;
    close(): void;
}
//# sourceMappingURL=reader.d.ts.map