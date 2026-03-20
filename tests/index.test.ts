/**
 * agent-trace v0.1 — comprehensive test suite
 * 25 tests covering: schema, parseRow, SQLiteSpanExporter, TraceReader,
 * groupByTrace, formatDuration, buildTree, edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SCHEMA_SQL, parseRow, type SpanRow } from '../src/schema.js';
import { SQLiteSpanExporter } from '../src/db/exporter.js';
import { TraceReader } from '../src/db/reader.js';
import { formatDuration, groupByTrace } from '../src/commands/traces.js';
import { buildTree } from '../src/commands/show.js';
import type { SpanRecord } from '../src/schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDb(): string {
  return path.join(os.tmpdir(), `agent-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function makeFileDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

const INSERT_SQL = `
  INSERT OR REPLACE INTO spans
    (id, trace_id, parent_id, name, start_time, end_time, status_code, status_msg, attributes)
  VALUES
    (@id, @trace_id, @parent_id, @name, @start_time, @end_time, @status_code, @status_msg, @attributes)
`;

function insertSpan(
  db: Database.Database,
  row: Partial<SpanRow> & { id: string; trace_id: string; name: string },
): void {
  const now = Date.now() * 1e6;
  db.prepare(INSERT_SQL).run({
    id: row.id,
    trace_id: row.trace_id,
    parent_id: row.parent_id ?? null,
    name: row.name,
    start_time: row.start_time ?? now,
    end_time: row.end_time ?? (now + 1_000_000),
    status_code: row.status_code ?? 1,
    status_msg: row.status_msg ?? null,
    attributes: row.attributes ?? '{}',
  });
}

/** Minimal OTel-compatible span object for SQLiteSpanExporter */
function makeOtelSpan(overrides: {
  name?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  statusCode?: number;
  startMs?: number;
  durationMs?: number;
  attributes?: Record<string, string | number | boolean>;
}) {
  const startMs = overrides.startMs ?? Date.now();
  const durationMs = overrides.durationMs ?? 100;
  const startSec = Math.floor(startMs / 1000);
  const startNs = (startMs % 1000) * 1_000_000;
  const endMs = startMs + durationMs;
  const endSec = Math.floor(endMs / 1000);
  const endNs = (endMs % 1000) * 1_000_000;

  return {
    name: overrides.name ?? 'test.span',
    spanContext: () => ({
      traceId: overrides.traceId ?? 'aaaa'.repeat(8),
      spanId: overrides.spanId ?? 'bbbb'.repeat(2),
    }),
    parentSpanId: overrides.parentSpanId,
    startTime: [startSec, startNs] as [number, number],
    endTime: [endSec, endNs] as [number, number],
    status: { code: overrides.statusCode ?? 1, message: undefined },
    attributes: overrides.attributes ?? {},
  };
}

function makeSpanRecord(overrides: Partial<SpanRecord> & { id: string; trace_id: string; name: string }): SpanRecord {
  const t0 = Date.now() * 1e6;
  return {
    id: overrides.id,
    trace_id: overrides.trace_id,
    parent_id: overrides.parent_id ?? null,
    name: overrides.name,
    start_time: overrides.start_time ?? t0,
    end_time: overrides.end_time ?? t0 + 1_000_000,
    status_code: overrides.status_code ?? 1,
    status_msg: overrides.status_msg ?? null,
    attributes: overrides.attributes ?? {},
    duration_ms: overrides.duration_ms ?? 1,
    created_at: overrides.created_at ?? new Date().toISOString(),
  };
}

// ─── 1. Schema ─────────────────────────────────────────────────────────────────

describe('SQLite schema', () => {
  it('creates the spans table', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spans'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('spans');
    db.close();
  });

  it('creates indexes on trace_id and start_time', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='spans'")
      .all() as { name: string }[];
    const names = indexes.map(i => i.name);
    expect(names).toContain('idx_spans_trace_id');
    expect(names).toContain('idx_spans_start_time');
    db.close();
  });

  it('SCHEMA_SQL is idempotent — running twice does not throw', () => {
    const db = new Database(':memory:');
    expect(() => {
      db.exec(SCHEMA_SQL);
      db.exec(SCHEMA_SQL);
    }).not.toThrow();
    db.close();
  });
});

// ─── 2. parseRow ───────────────────────────────────────────────────────────────

describe('parseRow()', () => {
  it('deserializes attributes from JSON', () => {
    const row: SpanRow = {
      id: 's1', trace_id: 't1', parent_id: null, name: 'gen_ai.chat',
      start_time: 1000000, end_time: 2000000, status_code: 1, status_msg: null,
      attributes: JSON.stringify({ 'gen_ai.system': 'anthropic', 'gen_ai.request.model': 'claude-sonnet-4-6' }),
      created_at: '2026-01-01 00:00:00',
    };
    const record = parseRow(row);
    expect(record.attributes['gen_ai.system']).toBe('anthropic');
    expect(record.attributes['gen_ai.request.model']).toBe('claude-sonnet-4-6');
  });

  it('calculates duration_ms from nanosecond timestamps', () => {
    const row: SpanRow = {
      id: 's2', trace_id: 't2', parent_id: null, name: 'test',
      start_time: 0, end_time: 750_000_000,  // 750ms in nanoseconds
      status_code: 1, status_msg: null, attributes: '{}', created_at: '2026-01-01 00:00:00',
    };
    const record = parseRow(row);
    expect(record.duration_ms).toBeCloseTo(750, 0);
  });

  it('preserves null parent_id', () => {
    const row: SpanRow = {
      id: 's3', trace_id: 't3', parent_id: null, name: 'root',
      start_time: 0, end_time: 1_000_000, status_code: 1,
      status_msg: null, attributes: '{}', created_at: '2026-01-01 00:00:00',
    };
    expect(parseRow(row).parent_id).toBeNull();
  });
});

// ─── 3. SQLiteSpanExporter ─────────────────────────────────────────────────────

describe('SQLiteSpanExporter', () => {
  let dbPath: string;

  beforeEach(() => { dbPath = tmpDb(); });
  afterEach(() => { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); });

  it('exports a span and writes it to SQLite', () => {
    const exporter = new SQLiteSpanExporter(dbPath);
    const span = makeOtelSpan({ name: 'agent.run', traceId: 'trace001'.padEnd(32, '0'), spanId: 'span001'.padEnd(16, '0') });

    let exportResult: number | undefined;
    exporter.export([span], (result) => { exportResult = result.code; });

    expect(exportResult).toBe(0);  // ExportResultCode.SUCCESS = 0

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT * FROM spans WHERE id = ?').get(span.spanContext().spanId) as SpanRow | undefined;
    db.close();

    expect(row).toBeDefined();
    expect(row?.name).toBe('agent.run');
    expect(row?.trace_id).toBe(span.spanContext().traceId);
  });

  it('stores parentSpanId correctly', () => {
    const exporter = new SQLiteSpanExporter(dbPath);
    const span = makeOtelSpan({
      traceId: 'trace002'.padEnd(32, '0'),
      spanId: 'childspan'.padEnd(16, '0'),
      parentSpanId: 'parentsp'.padEnd(16, '0'),
    });
    exporter.export([span], () => {});

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT parent_id FROM spans WHERE id = ?').get(span.spanContext().spanId) as { parent_id: string } | undefined;
    db.close();

    expect(row?.parent_id).toBe('parentsp'.padEnd(16, '0'));
  });

  it('stores ERROR status code', () => {
    const exporter = new SQLiteSpanExporter(dbPath);
    const span = makeOtelSpan({ statusCode: 2, name: 'failed.op' });
    exporter.export([span], () => {});

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT status_code FROM spans WHERE name = ?').get('failed.op') as { status_code: number } | undefined;
    db.close();

    expect(row?.status_code).toBe(2);
  });

  it('exports multiple spans in a single transaction', () => {
    const exporter = new SQLiteSpanExporter(dbPath);
    const traceId = 'multi'.padEnd(32, '0');
    const spans = [
      makeOtelSpan({ traceId, spanId: 'sp001'.padEnd(16, '0'), name: 'root' }),
      makeOtelSpan({ traceId, spanId: 'sp002'.padEnd(16, '0'), name: 'child1', parentSpanId: 'sp001'.padEnd(16, '0') }),
      makeOtelSpan({ traceId, spanId: 'sp003'.padEnd(16, '0'), name: 'child2', parentSpanId: 'sp001'.padEnd(16, '0') }),
    ];
    exporter.export(spans, () => {});

    const db = new Database(dbPath, { readonly: true });
    const count = (db.prepare('SELECT COUNT(*) as n FROM spans WHERE trace_id = ?').get(traceId) as { n: number }).n;
    db.close();

    expect(count).toBe(3);
  });

  it('is idempotent — OR REPLACE prevents duplicate key errors', () => {
    const exporter = new SQLiteSpanExporter(dbPath);
    const span = makeOtelSpan({ spanId: 'idempotnt'.padEnd(16, '0'), name: 'dupe.span' });

    let result1: number | undefined;
    let result2: number | undefined;
    exporter.export([span], (r) => { result1 = r.code; });
    exporter.export([span], (r) => { result2 = r.code; });

    expect(result1).toBe(0);
    expect(result2).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    const count = (db.prepare('SELECT COUNT(*) as n FROM spans WHERE id = ?').get(span.spanContext().spanId) as { n: number }).n;
    db.close();

    expect(count).toBe(1);  // not 2
  });

  it('stores GenAI semantic attributes in JSON', () => {
    const exporter = new SQLiteSpanExporter(dbPath);
    const span = makeOtelSpan({
      attributes: {
        'gen_ai.system': 'anthropic',
        'gen_ai.request.model': 'claude-sonnet-4-6',
        'gen_ai.usage.input_tokens': 500,
      },
    });
    exporter.export([span], () => {});

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT attributes FROM spans LIMIT 1').get() as { attributes: string } | undefined;
    db.close();

    const attrs = JSON.parse(row!.attributes) as Record<string, unknown>;
    expect(attrs['gen_ai.system']).toBe('anthropic');
    expect(attrs['gen_ai.usage.input_tokens']).toBe(500);
  });
});

// ─── 4. TraceReader ────────────────────────────────────────────────────────────

describe('TraceReader', () => {
  let dbPath: string;
  let fileDb: Database.Database;

  beforeEach(() => {
    dbPath = tmpDb();
    fileDb = makeFileDb(dbPath);
  });

  afterEach(() => {
    try { fileDb.close(); } catch {}
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('query() returns all spans for a given traceId', () => {
    const traceId = 'trace-query-001';
    const t0 = Date.now() * 1e6;
    insertSpan(fileDb, { id: 'sq-1', trace_id: traceId, name: 'root', start_time: t0, end_time: t0 + 1_000_000 });
    insertSpan(fileDb, { id: 'sq-2', trace_id: traceId, name: 'child', parent_id: 'sq-1', start_time: t0 + 100_000, end_time: t0 + 900_000 });
    insertSpan(fileDb, { id: 'sq-other', trace_id: 'other-trace', name: 'unrelated', start_time: t0, end_time: t0 + 500_000 });
    fileDb.close();

    const reader = new TraceReader(dbPath);
    try {
      const results = reader.query({ traceId });
      expect(results).toHaveLength(2);
      expect(results.every(s => s.trace_id === traceId)).toBe(true);
    } finally {
      reader.close();
    }
  });

  it('query() respects the limit option', () => {
    const t0 = Date.now() * 1e6;
    for (let i = 0; i < 10; i++) {
      insertSpan(fileDb, { id: `lim-${i}`, trace_id: `trace-lim-${i}`, name: 'span', start_time: t0 + i * 1_000_000, end_time: t0 + i * 1_000_000 + 100_000 });
    }
    fileDb.close();

    const reader = new TraceReader(dbPath);
    try {
      const results = reader.query({ limit: 3 });
      expect(results).toHaveLength(3);
    } finally {
      reader.close();
    }
  });

  it('query() filters by name substring', () => {
    const t0 = Date.now() * 1e6;
    insertSpan(fileDb, { id: 'name-1', trace_id: 'trace-name', name: 'gen_ai.chat', start_time: t0, end_time: t0 + 1e6 });
    insertSpan(fileDb, { id: 'name-2', trace_id: 'trace-name', name: 'agent.run', start_time: t0 + 1e6, end_time: t0 + 2e6 });
    fileDb.close();

    const reader = new TraceReader(dbPath);
    try {
      const results = reader.query({ name: 'gen_ai' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('gen_ai.chat');
    } finally {
      reader.close();
    }
  });

  it('query() returns empty array when no spans match', () => {
    fileDb.close();
    const reader = new TraceReader(dbPath);
    try {
      expect(reader.query({ traceId: 'nonexistent' })).toHaveLength(0);
    } finally {
      reader.close();
    }
  });

  it('getTrace() returns spans ordered by start_time ASC', () => {
    const traceId = 'trace-order-test';
    const t0 = Date.now() * 1e6;
    // Insert in reverse order
    insertSpan(fileDb, { id: 'ord-3', trace_id: traceId, name: 'third', start_time: t0 + 2_000_000, end_time: t0 + 3_000_000 });
    insertSpan(fileDb, { id: 'ord-1', trace_id: traceId, name: 'first', start_time: t0, end_time: t0 + 1_000_000 });
    insertSpan(fileDb, { id: 'ord-2', trace_id: traceId, name: 'second', start_time: t0 + 1_000_000, end_time: t0 + 2_000_000 });
    fileDb.close();

    const reader = new TraceReader(dbPath);
    try {
      const spans = reader.getTrace(traceId);
      expect(spans).toHaveLength(3);
      expect(spans[0].name).toBe('first');
      expect(spans[1].name).toBe('second');
      expect(spans[2].name).toBe('third');
    } finally {
      reader.close();
    }
  });

  it('getTrace() returns empty array for unknown traceId', () => {
    fileDb.close();
    const reader = new TraceReader(dbPath);
    try {
      expect(reader.getTrace('no-such-trace')).toHaveLength(0);
    } finally {
      reader.close();
    }
  });

  it('count() returns the correct number of spans', () => {
    const t0 = Date.now() * 1e6;
    insertSpan(fileDb, { id: 'cnt-1', trace_id: 'tc1', name: 'a', start_time: t0, end_time: t0 + 1e6 });
    insertSpan(fileDb, { id: 'cnt-2', trace_id: 'tc1', name: 'b', start_time: t0 + 1e6, end_time: t0 + 2e6 });
    insertSpan(fileDb, { id: 'cnt-3', trace_id: 'tc2', name: 'c', start_time: t0 + 2e6, end_time: t0 + 3e6 });
    fileDb.close();

    const reader = new TraceReader(dbPath);
    try {
      expect(reader.count()).toBe(3);
    } finally {
      reader.close();
    }
  });

  it('throws when DB file does not exist', () => {
    expect(() => new TraceReader('/tmp/no-such-file-agent-trace.db')).toThrow();
  });
});

// ─── 5. formatDuration ─────────────────────────────────────────────────────────

describe('formatDuration()', () => {
  it('formats sub-millisecond as µs', () => {
    expect(formatDuration(0.5)).toBe('500µs');
    expect(formatDuration(0.001)).toBe('1µs');
  });

  it('formats 1–999ms as ms with 1 decimal', () => {
    expect(formatDuration(1)).toBe('1.0ms');
    expect(formatDuration(342.7)).toBe('342.7ms');
    expect(formatDuration(999)).toBe('999.0ms');
  });

  it('formats >= 1000ms as seconds with 2 decimals', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(2345)).toBe('2.35s');
    expect(formatDuration(60000)).toBe('60.00s');
  });
});

// ─── 6. groupByTrace ───────────────────────────────────────────────────────────

describe('groupByTrace()', () => {
  it('groups spans by trace_id', () => {
    const t0 = Date.now() * 1e6;
    const spans = [
      makeSpanRecord({ id: 'g1', trace_id: 'trace-A', name: 'root', start_time: t0, end_time: t0 + 1e9 }),
      makeSpanRecord({ id: 'g2', trace_id: 'trace-A', name: 'child', parent_id: 'g1', start_time: t0 + 1e8, end_time: t0 + 9e8 }),
      makeSpanRecord({ id: 'g3', trace_id: 'trace-B', name: 'root', start_time: t0 + 2e9, end_time: t0 + 3e9 }),
    ];
    const groups = groupByTrace(spans);
    expect(groups).toHaveLength(2);
    const traceA = groups.find(g => g.traceId === 'trace-A');
    expect(traceA?.spanCount).toBe(2);
    const traceB = groups.find(g => g.traceId === 'trace-B');
    expect(traceB?.spanCount).toBe(1);
  });

  it('sorts traces most-recent first by start_time', () => {
    const t0 = Date.now() * 1e6;
    const spans = [
      makeSpanRecord({ id: 'old-1', trace_id: 'trace-old', name: 'root', start_time: t0, end_time: t0 + 1e9 }),
      makeSpanRecord({ id: 'new-1', trace_id: 'trace-new', name: 'root', start_time: t0 + 5e9, end_time: t0 + 6e9 }),
    ];
    const groups = groupByTrace(spans);
    expect(groups[0].traceId).toBe('trace-new');
    expect(groups[1].traceId).toBe('trace-old');
  });

  it('extracts rootCommand from root span (null parent_id)', () => {
    const t0 = Date.now() * 1e6;
    const spans = [
      makeSpanRecord({
        id: 'rc-root', trace_id: 'trace-rc', name: 'agent.run', parent_id: null,
        start_time: t0, end_time: t0 + 2e9,
        attributes: { command: 'claude -p "hello"' },
      }),
      makeSpanRecord({
        id: 'rc-child', trace_id: 'trace-rc', name: 'agent.step', parent_id: 'rc-root',
        start_time: t0 + 1e8, end_time: t0 + 1e9,
      }),
    ];
    const groups = groupByTrace(spans);
    expect(groups[0].rootCommand).toBe('claude -p "hello"');
  });

  it('calculates totalDurationMs as last.end - first.start in nanoseconds', () => {
    const t0 = 1_000_000_000_000_000;  // arbitrary nanoseconds
    const spans = [
      makeSpanRecord({ id: 'dur-1', trace_id: 'trace-dur', name: 'root', start_time: t0, end_time: t0 + 1e9 }),
      makeSpanRecord({ id: 'dur-2', trace_id: 'trace-dur', name: 'child', parent_id: 'dur-1', start_time: t0 + 1e8, end_time: t0 + 2e9 }),
    ];
    const groups = groupByTrace(spans);
    // last.end_time = t0 + 2e9, first.start_time = t0
    // totalDurationMs = 2e9 / 1e6 = 2000ms
    expect(groups[0].totalDurationMs).toBeCloseTo(2000, 0);
  });
});

// ─── 7. buildTree ──────────────────────────────────────────────────────────────

describe('buildTree()', () => {
  it('groups root spans under null key', () => {
    const t0 = Date.now() * 1e6;
    const spans = [
      makeSpanRecord({ id: 'bt-root', trace_id: 't1', name: 'root', parent_id: null, start_time: t0, end_time: t0 + 1e9 }),
      makeSpanRecord({ id: 'bt-child', trace_id: 't1', name: 'child', parent_id: 'bt-root', start_time: t0 + 1e8, end_time: t0 + 9e8 }),
    ];
    const tree = buildTree(spans);
    expect(tree.get(null)).toHaveLength(1);
    expect(tree.get(null)![0].name).toBe('root');
  });

  it('groups child spans under their parent span ID', () => {
    const t0 = Date.now() * 1e6;
    const spans = [
      makeSpanRecord({ id: 'par', trace_id: 't2', name: 'parent', parent_id: null, start_time: t0, end_time: t0 + 3e9 }),
      makeSpanRecord({ id: 'ch1', trace_id: 't2', name: 'child1', parent_id: 'par', start_time: t0 + 1e8, end_time: t0 + 1e9 }),
      makeSpanRecord({ id: 'ch2', trace_id: 't2', name: 'child2', parent_id: 'par', start_time: t0 + 1e9, end_time: t0 + 2e9 }),
    ];
    const tree = buildTree(spans);
    expect(tree.get('par')).toHaveLength(2);
    const childNames = tree.get('par')!.map(s => s.name);
    expect(childNames).toContain('child1');
    expect(childNames).toContain('child2');
  });

  it('returns empty map for empty span array', () => {
    const tree = buildTree([]);
    expect(tree.size).toBe(0);
  });
});

// ─── 8. Edge cases ─────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('SQLiteSpanExporter creates schema on first open', () => {
    const dbPath = tmpDb();
    try {
      const exporter = new SQLiteSpanExporter(dbPath);
      exporter.close();
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spans'")
        .get() as { name: string } | undefined;
      db.close();
      expect(row?.name).toBe('spans');
    } finally {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it('TraceReader.query() on empty DB returns empty array', () => {
    const dbPath = tmpDb();
    try {
      const db = makeFileDb(dbPath);
      db.close();
      const reader = new TraceReader(dbPath);
      try {
        expect(reader.query()).toHaveLength(0);
        expect(reader.count()).toBe(0);
      } finally {
        reader.close();
      }
    } finally {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it('attributes with numeric and boolean values round-trip correctly', () => {
    const row: SpanRow = {
      id: 'attr-rt', trace_id: 't-attr', parent_id: null, name: 'test',
      start_time: 0, end_time: 1_000_000, status_code: 1, status_msg: null,
      attributes: JSON.stringify({
        'gen_ai.usage.input_tokens': 1234,
        'gen_ai.usage.output_tokens': 567,
        'cache_hit': true,
        'exit_code': 0,
      }),
      created_at: '2026-01-01 00:00:00',
    };
    const record = parseRow(row);
    expect(record.attributes['gen_ai.usage.input_tokens']).toBe(1234);
    expect(record.attributes['cache_hit']).toBe(true);
    expect(record.attributes['exit_code']).toBe(0);
  });
});
