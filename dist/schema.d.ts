/**
 * agent-trace SQLite schema
 *
 * Single table: spans
 * - Stores OTel spans with GenAI semantic convention attributes
 * - WAL mode for concurrent reads during live tail
 */
export declare const SCHEMA_SQL = "\n  CREATE TABLE IF NOT EXISTS spans (\n    id          TEXT PRIMARY KEY,\n    trace_id    TEXT NOT NULL,\n    parent_id   TEXT,\n    name        TEXT NOT NULL,\n    start_time  INTEGER NOT NULL,\n    end_time    INTEGER NOT NULL,\n    status_code INTEGER NOT NULL DEFAULT 1,\n    status_msg  TEXT,\n    attributes  TEXT NOT NULL DEFAULT '{}',\n    created_at  TEXT DEFAULT (datetime('now'))\n  );\n\n  CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);\n  CREATE INDEX IF NOT EXISTS idx_spans_start_time ON spans(start_time DESC);\n  CREATE INDEX IF NOT EXISTS idx_spans_name ON spans(name);\n";
export interface SpanRow {
    id: string;
    trace_id: string;
    parent_id: string | null;
    name: string;
    start_time: number;
    end_time: number;
    status_code: number;
    status_msg: string | null;
    attributes: string;
    created_at: string;
}
export interface SpanRecord extends Omit<SpanRow, 'attributes'> {
    attributes: Record<string, unknown>;
    duration_ms: number;
}
export declare function parseRow(row: SpanRow): SpanRecord;
//# sourceMappingURL=schema.d.ts.map