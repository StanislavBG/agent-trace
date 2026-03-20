/**
 * agent-trace public API
 *
 * Use these exports to integrate agent-trace into your own scripts or tools.
 * For CLI usage, install globally and run `agent-trace record|traces|show|init`.
 */

export { SQLiteSpanExporter } from './db/exporter.js';
export { TraceReader } from './db/reader.js';
export { findDb } from './db/find-db.js';
export { SCHEMA_SQL, parseRow } from './schema.js';
export type { SpanRow, SpanRecord } from './schema.js';
export type { QueryOptions } from './db/reader.js';
