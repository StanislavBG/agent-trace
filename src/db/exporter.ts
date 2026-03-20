/**
 * SQLiteSpanExporter — OTel SpanExporter that writes to a local SQLite database.
 *
 * Ported from the Order #60 spike (agent-trace-spike/spike.js).
 * Uses WAL mode and prepared statements for performance.
 */

import Database from 'better-sqlite3';
import { ExportResultCode } from '@opentelemetry/core';
import type { ExportResult } from '@opentelemetry/core';
import { SCHEMA_SQL } from '../schema.js';

// Minimal interface matching OTel ReadableSpan — avoids importing from sdk-trace-base internals
interface OtelSpan {
  name: string;
  spanContext(): { traceId: string; spanId: string };
  parentSpanId?: string;
  startTime: [number, number];  // HrTime: [seconds, nanoseconds]
  endTime: [number, number];
  status: { code: number; message?: string };
  attributes: Record<string, string | number | boolean | string[] | undefined>;
}

export class SQLiteSpanExporter {
  private db: Database.Database;
  private _insert: Database.Statement;

  constructor(dbPath: string) {
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

  export(spans: OtelSpan[], resultCallback: (result: ExportResult) => void): void {
    try {
      const insertMany = this.db.transaction((spansToInsert: OtelSpan[]) => {
        for (const span of spansToInsert) {
          const ctx = span.spanContext();
          const startNs = span.startTime[0] * 1e9 + span.startTime[1];
          const endNs = span.endTime[0] * 1e9 + span.endTime[1];

          this._insert.run({
            id:          ctx.spanId,
            trace_id:    ctx.traceId,
            parent_id:   span.parentSpanId ?? null,
            name:        span.name,
            start_time:  startNs,
            end_time:    endNs,
            status_code: span.status.code,
            status_msg:  span.status.message ?? null,
            attributes:  JSON.stringify(span.attributes),
          });
        }
      });
      insertMany(spans);
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (err) {
      resultCallback({ code: ExportResultCode.FAILED, error: err as Error });
    }
  }

  shutdown(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }

  /** Close without destroying — use when you need the DB open for reading after export */
  close(): void {
    this.db.close();
  }
}

/** Open a read-only connection to an existing traces.db */
export function openReadOnly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true });
}
