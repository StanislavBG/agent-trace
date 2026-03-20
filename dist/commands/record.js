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
import * as otelApi from '@opentelemetry/api';
import { ATTR_GEN_AI_SYSTEM, ATTR_GEN_AI_OPERATION_NAME, } from '@opentelemetry/semantic-conventions/incubating';
import { SQLiteSpanExporter } from '../db/exporter.js';
/** Walk up from dir looking for .agent-trace/traces.db; return path if found */
function findDb(dir) {
    const candidate = path.join(dir, '.agent-trace', 'traces.db');
    if (fs.existsSync(candidate))
        return candidate;
    const parent = path.dirname(dir);
    if (parent === dir)
        return null; // filesystem root
    return findDb(parent);
}
/** Resolve DB path: find existing or create in cwd */
function resolveDbPath(cwd) {
    const found = findDb(cwd);
    if (found)
        return found;
    const dir = path.join(cwd, '.agent-trace');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'traces.db');
}
async function runRecord(command) {
    const dbPath = resolveDbPath(process.cwd());
    const exporter = new SQLiteSpanExporter(dbPath);
    const provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const tracer = otelApi.trace.getTracer('agent-trace', '0.1.0');
    const span = tracer.startSpan('agent.run', {
        attributes: {
            [ATTR_GEN_AI_SYSTEM]: 'agent-trace',
            [ATTR_GEN_AI_OPERATION_NAME]: 'run',
            'command': command,
        },
    });
    const ctx = otelApi.context.with(otelApi.trace.setSpan(otelApi.context.active(), span), () => {
        // context established — return it for use below
        return otelApi.context.active();
    });
    const exitCode = await new Promise((resolve) => {
        const child = spawn('sh', ['-c', command], { stdio: 'inherit' });
        child.on('exit', (code) => {
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
    }
    else {
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
    .action(async (command) => {
    await runRecord(command);
});
//# sourceMappingURL=record.js.map