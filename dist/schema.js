/**
 * agent-trace SQLite schema
 *
 * Single table: spans
 * - Stores OTel spans with GenAI semantic convention attributes
 * - WAL mode for concurrent reads during live tail
 */
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS spans (
    id          TEXT PRIMARY KEY,
    trace_id    TEXT NOT NULL,
    parent_id   TEXT,
    name        TEXT NOT NULL,
    start_time  INTEGER NOT NULL,
    end_time    INTEGER NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 1,
    status_msg  TEXT,
    attributes  TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
  CREATE INDEX IF NOT EXISTS idx_spans_start_time ON spans(start_time DESC);
  CREATE INDEX IF NOT EXISTS idx_spans_name ON spans(name);
`;
export function parseRow(row) {
    return {
        ...row,
        attributes: JSON.parse(row.attributes),
        duration_ms: (row.end_time - row.start_time) / 1e6,
    };
}
//# sourceMappingURL=schema.js.map