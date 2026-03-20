/**
 * SQLiteSpanExporter — OTel SpanExporter that writes to a local SQLite database.
 *
 * Ported from the Order #60 spike (agent-trace-spike/spike.js).
 * Uses WAL mode and prepared statements for performance.
 */
import Database from 'better-sqlite3';
import { ExportResultCode } from '@opentelemetry/core';
import { SCHEMA_SQL } from '../schema.js';
export class SQLiteSpanExporter {
    db;
    _insert;
    constructor(dbPath) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(SCHEMA_SQL);
        this._insert = this.db.prepare(`
      INSERT OR REPLACE INTO spans
        (id, trace_id, parent_id, name, start_time, end_time, status_code, status_msg, attributes)
      VALUES
        (@id, @trace_id, @parent_id, @name, @start_time, @end_time, @status_code, @status_msg, @attributes)
    `);
    }
    export(spans, resultCallback) {
        try {
            const insertMany = this.db.transaction((spansToInsert) => {
                for (const span of spansToInsert) {
                    const ctx = span.spanContext();
                    const startNs = span.startTime[0] * 1e9 + span.startTime[1];
                    const endNs = span.endTime[0] * 1e9 + span.endTime[1];
                    this._insert.run({
                        id: ctx.spanId,
                        trace_id: ctx.traceId,
                        parent_id: span.parentSpanId ?? null,
                        name: span.name,
                        start_time: startNs,
                        end_time: endNs,
                        status_code: span.status.code,
                        status_msg: span.status.message ?? null,
                        attributes: JSON.stringify(span.attributes),
                    });
                }
            });
            insertMany(spans);
            resultCallback({ code: ExportResultCode.SUCCESS });
        }
        catch (err) {
            resultCallback({ code: ExportResultCode.FAILED, error: err });
        }
    }
    shutdown() {
        this.db.close();
        return Promise.resolve();
    }
    /** Close without destroying — use when you need the DB open for reading after export */
    close() {
        this.db.close();
    }
}
/** Open a read-only connection to an existing traces.db */
export function openReadOnly(dbPath) {
    return new Database(dbPath, { readonly: true });
}
//# sourceMappingURL=exporter.js.map