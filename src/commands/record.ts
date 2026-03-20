/**
 * agent-trace record <command> — wrap a shell command with OTel GenAI tracing.
 *
 * Spawns the command, opens an OTel span for its lifetime, stores to SQLite.
 * Finds or creates .agent-trace/traces.db walking up from cwd.
 */

import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import * as otelApi from '@opentelemetry/api';
import {
  ATTR_GEN_AI_SYSTEM,
  ATTR_GEN_AI_OPERATION_NAME,
} from '@opentelemetry/semantic-conventions/incubating';
import { SQLiteSpanExporter } from '../db/exporter.js';
import { findDb } from '../db/find-db.js';

/** Resolve DB path: find existing or create in cwd */
function resolveDbPath(cwd: string): string {
  const found = findDb(cwd);
  if (found) return found;
  const dir = path.join(cwd, '.agent-trace');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'traces.db');
}

async function runRecord(command: string, opts: { timeout?: number } = {}): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) {
    console.error('agent-trace: command must not be empty');
    process.exit(1);
  }

  const dbPath = resolveDbPath(process.cwd());
  const exporter = new SQLiteSpanExporter(dbPath);

  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter as unknown as SpanExporter)],
  });
  provider.register();

  const tracer = otelApi.trace.getTracer('agent-trace', '0.1.0');

  const span = tracer.startSpan('agent.run', {
    attributes: {
      [ATTR_GEN_AI_SYSTEM]: 'agent-trace',
      [ATTR_GEN_AI_OPERATION_NAME]: 'run',
      'command': trimmed,
    },
  });

  const exitCode = await new Promise<number>((resolve) => {
    const spawnOpts: Parameters<typeof spawn>[2] = { stdio: 'inherit' };
    if (opts.timeout && opts.timeout > 0) spawnOpts.timeout = opts.timeout * 1000;

    const child = spawn('sh', ['-c', trimmed], spawnOpts);

    process.on('SIGINT', () => {
      child.kill('SIGINT');
    });

    child.on('exit', (code, signal) => {
      if (signal === 'SIGTERM') {
        span.setStatus({ code: otelApi.SpanStatusCode.ERROR, message: `timed out after ${opts.timeout}s` });
      }
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      span.setStatus({ code: otelApi.SpanStatusCode.ERROR, message: err.message });
      resolve(1);
    });
  });

  span.setAttribute('exit_code', exitCode);
  if (exitCode === 0) {
    span.setStatus({ code: otelApi.SpanStatusCode.OK });
  } else {
    span.setStatus({ code: otelApi.SpanStatusCode.ERROR, message: `exit code ${exitCode}` });
  }
  span.end();

  // SimpleSpanProcessor is synchronous — span is already exported
  const traceId = span.spanContext().traceId;
  console.error(`\nagent-trace: recorded trace ${traceId.slice(0, 12)}… → ${dbPath}`);

  await provider.shutdown();
  process.exit(exitCode);
}

export const recordCommand = new Command('record')
  .description('Wrap a shell command with OTel GenAI tracing, store to SQLite')
  .argument('<command>', 'Shell command to run (e.g. \'claude -p "hello"\')')
  .option('-t, --timeout <seconds>', 'Kill command after N seconds', (v) => parseInt(v, 10))
  .action(async (command: string, opts: { timeout?: number }) => {
    await runRecord(command, opts);
  });
