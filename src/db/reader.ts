/**
 * TraceReader — query stored spans from SQLite.
 */

import Database from 'better-sqlite3';
import { parseRow, type SpanRecord, type SpanRow } from '../schema.js';

export interface QueryOptions {
  limit?: number;
  traceId?: string;
  name?: string;
  since?: string;  // ISO datetime string
}

export class TraceReader {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
  }

  query(opts: QueryOptions = {}): SpanRecord[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts.traceId) {
      conditions.push('trace_id = @traceId');
      params.traceId = opts.traceId;
    }
    if (opts.name) {
      conditions.push('name LIKE @name');
      params.name = `%${opts.name}%`;
    }
    if (opts.since) {
      conditions.push("created_at >= @since");
      params.since = opts.since;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = opts.limit ? `LIMIT ${Math.floor(opts.limit)}` : '';

    const sql = `SELECT * FROM spans ${where} ORDER BY start_time DESC ${limitClause}`;
    const rows = this.db.prepare(sql).all(params) as SpanRow[];
    return rows.map(parseRow);
  }

  getTrace(traceId: string): SpanRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC')
      .all(traceId) as SpanRow[];
    return rows.map(parseRow);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM spans').get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
