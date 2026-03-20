/**
 * SQLiteSpanExporter — OTel SpanExporter that writes to a local SQLite database.
 *
 * Ported from the Order #60 spike (agent-trace-spike/spike.js).
 * Uses WAL mode and prepared statements for performance.
 */
import Database from 'better-sqlite3';
import type { ExportResult } from '@opentelemetry/core';
interface OtelSpan {
    name: string;
    spanContext(): {
        traceId: string;
        spanId: string;
    };
    parentSpanId?: string;
    startTime: [number, number];
    endTime: [number, number];
    status: {
        code: number;
        message?: string;
    };
    attributes: Record<string, string | number | boolean | string[] | undefined>;
}
export declare class SQLiteSpanExporter {
    private db;
    private _insert;
    constructor(dbPath: string);
    export(spans: OtelSpan[], resultCallback: (result: ExportResult) => void): void;
    shutdown(): Promise<void>;
    /** Close without destroying — use when you need the DB open for reading after export */
    close(): void;
}
/** Open a read-only connection to an existing traces.db */
export declare function openReadOnly(dbPath: string): Database.Database;
export {};
//# sourceMappingURL=exporter.d.ts.map