/**
 * agent-trace show <traceId> — display span tree for a trace (prefix match OK).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { TraceReader } from '../db/reader.js';
import { findDb } from '../db/find-db.js';
import { formatDuration } from './traces.js';
import type { SpanRecord } from '../schema.js';

export function buildTree(spans: SpanRecord[]): Map<string | null, SpanRecord[]> {
  const tree = new Map<string | null, SpanRecord[]>();
  for (const span of spans) {
    const parent = span.parent_id ?? null;
    if (!tree.has(parent)) tree.set(parent, []);
    tree.get(parent)!.push(span);
  }
  return tree;
}

function printTree(
  tree: Map<string | null, SpanRecord[]>,
  parentId: string | null,
  depth: number,
): void {
  const children = tree.get(parentId) ?? [];
  for (const span of children) {
    const indent = '  '.repeat(depth);
    const prefix = depth === 0 ? '┌ ' : '├─ ';
    const duration = chalk.cyan(formatDuration(span.duration_ms));
    const statusLabel = span.status_code === 2 ? chalk.red('ERROR') : chalk.green('OK');
    const name = chalk.bold(span.name);

    const keyAttrs: string[] = [];
    const attrs = span.attributes;
    if (attrs['command']) keyAttrs.push(chalk.yellow(`cmd=${String(attrs['command']).slice(0, 50)}`));
    if (attrs['gen_ai.system']) keyAttrs.push(chalk.magenta(String(attrs['gen_ai.system'])));
    if (attrs['gen_ai.request.model']) keyAttrs.push(chalk.yellow(String(attrs['gen_ai.request.model'])));
    if (attrs['exit_code'] != null) keyAttrs.push(chalk.dim(`exit=${attrs['exit_code']}`));
    if (attrs['gen_ai.usage.input_tokens'] != null) keyAttrs.push(chalk.dim(`in=${attrs['gen_ai.usage.input_tokens']}`));
    if (attrs['gen_ai.usage.output_tokens'] != null) keyAttrs.push(chalk.dim(`out=${attrs['gen_ai.usage.output_tokens']}`));

    const line = [indent + prefix + name, statusLabel, duration, ...keyAttrs].join('  ');
    console.log(line);

    printTree(tree, span.id, depth + 1);
  }
}

/** Find the full traceId from a prefix */
export function resolveTraceId(reader: TraceReader, prefix: string): string | null {
  if (prefix.length >= 32) return prefix;  // already full
  const spans = reader.query({ limit: 200 });
  const match = spans.find(s => s.trace_id.startsWith(prefix));
  return match?.trace_id ?? null;
}

async function runShow(traceIdPrefix: string, opts: { db?: string }): Promise<void> {
  if (traceIdPrefix.length < 4) {
    console.error(chalk.red('Error: trace ID prefix must be at least 4 characters.'));
    process.exit(1);
  }

  const dbPath = opts.db ?? findDb(process.cwd());

  if (!dbPath) {
    console.log(chalk.yellow('No traces.db found.'));
    console.log(chalk.dim('Run `agent-trace init` or `agent-trace record <cmd>` first.'));
    return;
  }

  const reader = new TraceReader(dbPath);

  try {
    const traceId = resolveTraceId(reader, traceIdPrefix);

    if (!traceId) {
      console.log(chalk.yellow(`No trace found matching prefix: ${traceIdPrefix}`));
      return;
    }

    const spans = reader.getTrace(traceId);

    if (spans.length === 0) {
      console.log(chalk.dim(`No spans found for trace ${traceId}`));
      return;
    }

    const totalMs = spans.length > 0
      ? (spans[spans.length - 1].end_time - spans[0].start_time) / 1e6
      : 0;

    console.log(chalk.bold(`Trace: ${traceId}`));
    console.log(chalk.dim(`${spans.length} span(s)  total: ${formatDuration(totalMs)}  db: ${dbPath}`));
    console.log();

    const tree = buildTree(spans);
    printTree(tree, null, 0);
  } finally {
    reader.close();
  }
}

export const showCommand = new Command('show')
  .description('Show span tree for a trace ID (prefix match OK)')
  .argument('<traceId>', 'Trace ID or unique prefix (at least 4 chars)')
  .option('--db <path>', 'Path to traces.db (default: auto-discover)')
  .action(async (traceId: string, opts: { db?: string }) => {
    await runShow(traceId, opts);
  });
