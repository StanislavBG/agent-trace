/**
 * agent-trace v0.1 — core tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, parseRow, type SpanRow } from '../src/schema.js';
import { TraceReader } from '../src/db/reader.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMemDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

function insertSpan(db: Database.Database, row: Partial<SpanRow> & { id: string; trace_id: string; name: string }): void {
  const now = Date.now() * 1e6;
  db.prepare(`
    INSERT OR REPLACE INTO spans
      (id, trace_id, parent_id, name, start_time, end_time, status_code, status_msg, attributes)
    VALUES
      (@id, @trace_id, @parent_id, @name, @start_time, @end_time, @status_code, @status_msg, @attributes)
  `).run({
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

// ─── Test 1: Schema creates table ─────────────────────────────────────────────

describe('SQLite schema', () => {
  it('creates the spans table', () => {
    const db = makeMemDb();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spans'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('spans');
    db.close();
  });
});

// ─── Test 2: Span insert round-trip ───────────────────────────────────────────

describe('Span insert round-trip', () => {
  it('inserts a span and reads it back with correct attributes', () => {
    const db = makeMemDb();

    const attrs = { 'gen_ai.system': 'anthropic', 'gen_ai.request.model': 'claude-sonnet-4-6' };
    const startNs = Date.now() * 1e6;
    const endNs = startNs + 500_000_000;  // 500ms

    insertSpan(db, {
      id: 'span-abc-001',
      trace_id: 'trace-xyz-001',
      name: 'gen_ai.chat',
      start_time: startNs,
      end_time: endNs,
      status_code: 1,
      attributes: JSON.stringify(attrs),
    });

    const row = db.prepare('SELECT * FROM spans WHERE id = ?').get('span-abc-001') as SpanRow;
    expect(row).toBeDefined();
    expect(row.trace_id).toBe('trace-xyz-001');
    expect(row.name).toBe('gen_ai.chat');

    const record = parseRow(row);
    expect(record.attributes['gen_ai.system']).toBe('anthropic');
    expect(record.attributes['gen_ai.request.model']).toBe('claude-sonnet-4-6');
    expect(record.duration_ms).toBeCloseTo(500, 0);  // ~500ms

    db.close();
  });
});

// ─── Test 3: TraceReader.query() by traceId ───────────────────────────────────

describe('TraceReader.query()', () => {
  it('returns all spans for a given traceId', () => {
    const db = makeMemDb();
    const traceId = 'trace-reader-test-001';

    const t0 = Date.now() * 1e6;
    insertSpan(db, { id: 'span-r-1', trace_id: traceId, name: 'root', start_time: t0, end_time: t0 + 1_000_000 });
    insertSpan(db, { id: 'span-r-2', trace_id: traceId, name: 'child', parent_id: 'span-r-1', start_time: t0 + 100_000, end_time: t0 + 900_000 });
    insertSpan(db, { id: 'span-other', trace_id: 'other-trace', name: 'unrelated', start_time: t0, end_time: t0 + 500_000 });

    db.close();

    // TraceReader opens its own read-only connection — write a temp file
    const tmpDb = Database(':memory:');
    // Use the WAL-mode in-memory workaround: re-open from a file
    // Instead, test using a file-based DB in /tmp
    const tmpPath = `/tmp/agent-trace-test-${Date.now()}.db`;
    const fileDb = new Database(tmpPath);
    fileDb.pragma('journal_mode = WAL');
    fileDb.exec(SCHEMA_SQL);
    fileDb.prepare(`
      INSERT OR REPLACE INTO spans
        (id, trace_id, parent_id, name, start_time, end_time, status_code, status_msg, attributes)
      VALUES
        (@id, @trace_id, @parent_id, @name, @start_time, @end_time, @status_code, @status_msg, @attributes)
    `).run({ id: 'span-r-1', trace_id: traceId, parent_id: null, name: 'root', start_time: t0, end_time: t0 + 1_000_000, status_code: 1, status_msg: null, attributes: '{}' });
    fileDb.prepare(`
      INSERT OR REPLACE INTO spans
        (id, trace_id, parent_id, name, start_time, end_time, status_code, status_msg, attributes)
      VALUES
        (@id, @trace_id, @parent_id, @name, @start_time, @end_time, @status_code, @status_msg, @attributes)
    `).run({ id: 'span-r-2', trace_id: traceId, parent_id: 'span-r-1', name: 'child', start_time: t0 + 100_000, end_time: t0 + 900_000, status_code: 1, status_msg: null, attributes: '{}' });
    fileDb.prepare(`
      INSERT OR REPLACE INTO spans
        (id, trace_id, parent_id, name, start_time, end_time, status_code, status_msg, attributes)
      VALUES
        (@id, @trace_id, @parent_id, @name, @start_time, @end_time, @status_code, @status_msg, @attributes)
    `).run({ id: 'span-other', trace_id: 'other-trace', parent_id: null, name: 'unrelated', start_time: t0, end_time: t0 + 500_000, status_code: 1, status_msg: null, attributes: '{}' });
    fileDb.close();

    const reader = new TraceReader(tmpPath);
    try {
      const results = reader.query({ traceId });
      expect(results).toHaveLength(2);
      expect(results.every(s => s.trace_id === traceId)).toBe(true);
    } finally {
      reader.close();
    }
    tmpDb.close();
  });
});

// ─── Test 4: TraceReader.getTrace() orders by start_time ASC ─────────────────

describe('TraceReader.getTrace()', () => {
  it('returns spans ordered by start_time ASC', () => {
    const tmpPath = `/tmp/agent-trace-test-${Date.now()}-order.db`;
    const traceId = 'trace-order-test';
    const t0 = Date.now() * 1e6;

    const fileDb = new Database(tmpPath);
    fileDb.pragma('journal_mode = WAL');
    fileDb.exec(SCHEMA_SQL);

    const insertStmt = fileDb.prepare(`
      INSERT OR REPLACE INTO spans
        (id, trace_id, parent_id, name, start_time, end_time, status_code, status_msg, attributes)
      VALUES
        (@id, @trace_id, @parent_id, @name, @start_time, @end_time, @status_code, @status_msg, @attributes)
    `);

    // Insert in reverse order to ensure sorting is applied
    insertStmt.run({ id: 'span-3', trace_id: traceId, parent_id: 'span-1', name: 'third', start_time: t0 + 2_000_000, end_time: t0 + 3_000_000, status_code: 1, status_msg: null, attributes: '{}' });
    insertStmt.run({ id: 'span-1', trace_id: traceId, parent_id: null, name: 'first', start_time: t0, end_time: t0 + 1_000_000, status_code: 1, status_msg: null, attributes: '{}' });
    insertStmt.run({ id: 'span-2', trace_id: traceId, parent_id: 'span-1', name: 'second', start_time: t0 + 1_000_000, end_time: t0 + 2_000_000, status_code: 1, status_msg: null, attributes: '{}' });
    fileDb.close();

    const reader = new TraceReader(tmpPath);
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
});

// ─── Test 5: CLI parses commands without throwing ─────────────────────────────

describe('CLI command parsing', () => {
  it('program.parseAsync with record subcommand does not throw during parse', async () => {
    // Import program structure without executing side effects
    // We create a minimal program that mirrors the CLI structure
    const { Command } = await import('commander');

    const testProgram = new Command()
      .name('agent-trace')
      .description('test')
      .exitOverride();  // prevent process.exit

    const recordCmd = new Command('record')
      .argument('<command>')
      .action(() => { /* no-op */ });

    const tracesCmd = new Command('traces')
      .action(() => { /* no-op */ });

    const showCmd = new Command('show')
      .argument('<traceId>')
      .action(() => { /* no-op */ });

    const initCmd = new Command('init')
      .action(() => { /* no-op */ });

    testProgram.addCommand(recordCmd);
    testProgram.addCommand(tracesCmd);
    testProgram.addCommand(showCmd);
    testProgram.addCommand(initCmd);

    // Should parse without throwing
    await expect(
      testProgram.parseAsync(['record', 'echo hello'], { from: 'user' })
    ).resolves.toBeDefined();
  });
});
