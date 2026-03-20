/**
 * agent-trace traces — list recent traces grouped by trace_id.
 */

import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { TraceReader } from '../db/reader.js';
import type { SpanRecord } from '../schema.js';

function findDb(dir: string): string | null {
  const candidate = path.join(dir, '.agent-trace', 'traces.db');
  if (fs.existsSync(candidate)) return candidate;
  const parent = path.dirname(dir);
  if (parent === dir) return null;
  return findDb(parent);
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface TraceGroup {
  traceId: string;
  spanCount: number;
  totalDurationMs: number;
  firstStartTime: number;
  firstCreatedAt: string;
  rootCommand?: string;
}

function groupByTrace(spans: SpanRecord[]): TraceGroup[] {
  const groups = new Map<string, SpanRecord[]>();

  for (const span of spans) {
    if (!groups.has(span.trace_id)) groups.set(span.trace_id, []);
    groups.get(span.trace_id)!.push(span);
  }

  const result: TraceGroup[] = [];

  for (const [traceId, traceSpans] of groups) {
    const sorted = traceSpans.sort((a, b) => a.start_time - b.start_time);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalDurationMs = (last.end_time - first.start_time) / 1e6;

    const root = sorted.find(s => s.parent_id == null) ?? first;
    const rootCommand = root.attributes['command'] as string | undefined;

    result.push({
      traceId,
      spanCount: traceSpans.length,
      totalDurationMs,
      firstStartTime: first.start_time,
      firstCreatedAt: first.created_at,
      rootCommand,
    });
  }

  // Sort by most recent first
  return result.sort((a, b) => b.firstStartTime - a.firstStartTime);
}

async function runTraces(opts: { limit: number }): Promise<void> {
  const dbPath = findDb(process.cwd());

  if (!dbPath) {
    console.log(chalk.yellow('No traces.db found.'));
    console.log(chalk.dim('Run `agent-trace init` to create one, or `agent-trace record <cmd>` to start recording.'));
    return;
  }

  const reader = new TraceReader(dbPath);

  try {
    // Fetch enough spans to cover the requested number of traces
    const spans = reader.query({ limit: opts.limit * 50 });

    if (spans.length === 0) {
      console.log(chalk.dim('No traces recorded yet.'));
      console.log(chalk.dim(`DB: ${dbPath}`));
      return;
    }

    const traces = groupByTrace(spans).slice(0, opts.limit);

    console.log(chalk.dim(`${traces.length} trace(s) — ${dbPath}`));
    console.log();

    for (const t of traces) {
      const traceShort = chalk.bold(t.traceId.slice(0, 12));
      const spanCount = chalk.dim(`${t.spanCount} span${t.spanCount !== 1 ? 's' : ''}`);
      const duration = chalk.cyan(formatDuration(t.totalDurationMs));
      const time = chalk.dim(t.firstCreatedAt);
      const cmd = t.rootCommand ? chalk.yellow(`  ${t.rootCommand.slice(0, 60)}`) : '';

      console.log(`${traceShort}…  ${spanCount}  ${duration}  ${time}${cmd}`);
    }
  } finally {
    reader.close();
  }
}

export const tracesCommand = new Command('traces')
  .description('List recent traces grouped by trace ID')
  .option('-n, --limit <n>', 'Number of traces to show', (v) => parseInt(v, 10), 20)
  .action(async (opts: { limit: number }) => {
    await runTraces(opts);
  });
