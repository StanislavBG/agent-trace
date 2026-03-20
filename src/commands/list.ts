/**
 * agent-trace list — query and display stored spans.
 */

import chalk from 'chalk';
import { TraceReader, type QueryOptions } from '../db/reader.js';
import type { SpanRecord } from '../schema.js';

export interface ListOptions {
  db: string;
  limit: number;
  name?: string;
  since?: string;
  json?: boolean;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'UNSET',
  1: 'OK',
  2: 'ERROR',
};

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatSpan(span: SpanRecord): string {
  const status = span.status_code === 2
    ? chalk.red(STATUS_LABELS[span.status_code] ?? String(span.status_code))
    : chalk.green(STATUS_LABELS[span.status_code] ?? String(span.status_code));

  const duration = chalk.cyan(formatDuration(span.duration_ms));
  const name = chalk.bold(span.name);
  const traceShort = chalk.dim(span.trace_id.slice(0, 16) + '…');
  const time = chalk.dim(span.created_at);

  const attrs = span.attributes as Record<string, unknown>;
  const model = attrs['gen_ai.request.model'] ? chalk.yellow(String(attrs['gen_ai.request.model'])) : '';
  const system = attrs['gen_ai.system'] ? chalk.magenta(String(attrs['gen_ai.system'])) : '';
  const inputTok = attrs['gen_ai.usage.input_tokens'] != null ? `in=${attrs['gen_ai.usage.input_tokens']}` : '';
  const outputTok = attrs['gen_ai.usage.output_tokens'] != null ? `out=${attrs['gen_ai.usage.output_tokens']}` : '';
  const tokens = [inputTok, outputTok].filter(Boolean).join(' ');

  const parts = [name, status, duration, traceShort];
  if (system) parts.push(system);
  if (model) parts.push(model);
  if (tokens) parts.push(chalk.dim(tokens));
  parts.push(time);

  return parts.filter(Boolean).join('  ');
}

export function runList(opts: ListOptions): void {
  const reader = new TraceReader(opts.db);

  try {
    const query: QueryOptions = {
      limit: opts.limit,
      name: opts.name,
      since: opts.since,
    };

    const spans = reader.query(query);

    if (spans.length === 0) {
      console.log(chalk.dim('No spans found.'));
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(spans, null, 2));
      return;
    }

    const total = reader.count();
    console.log(chalk.dim(`Showing ${spans.length} of ${total} spans — ${opts.db}`));
    console.log();

    for (const span of spans) {
      console.log(formatSpan(span));
    }
  } finally {
    reader.close();
  }
}
