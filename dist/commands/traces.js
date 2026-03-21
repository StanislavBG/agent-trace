/**
 * agent-trace traces — list recent traces grouped by trace_id.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { TraceReader } from '../db/reader.js';
import { findDb } from '../db/find-db.js';
import { formatSarif, formatJunit } from '../reporter/index.js';
import { guard } from '@preflight/license';
export function formatDuration(ms) {
    if (ms < 1)
        return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000)
        return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
export function groupByTrace(spans) {
    const groups = new Map();
    for (const span of spans) {
        if (!groups.has(span.trace_id))
            groups.set(span.trace_id, []);
        groups.get(span.trace_id).push(span);
    }
    const result = [];
    for (const [traceId, traceSpans] of groups) {
        const sorted = traceSpans.sort((a, b) => a.start_time - b.start_time);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalDurationMs = (last.end_time - first.start_time) / 1e6;
        const root = sorted.find(s => s.parent_id == null) ?? first;
        const rootCommand = root.attributes['command'];
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
function writeOrPrint(formatted, output) {
    if (output) {
        writeFileSync(resolve(output), formatted, 'utf-8');
    }
    else {
        process.stdout.write(formatted + '\n');
    }
}
async function runTraces(opts) {
    // SARIF and JUnit output are Team-tier features — gate them behind a license key
    if (opts.format === 'sarif' || opts.format === 'junit') {
        guard('team', { feature: `--format ${opts.format}` });
    }
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 20;
    const dbPath = findDb(process.cwd());
    if (!dbPath) {
        console.log(chalk.yellow('No traces.db found.'));
        console.log(chalk.dim('Run `agent-trace init` to create one, or `agent-trace record <cmd>` to start recording.'));
        return;
    }
    const reader = new TraceReader(dbPath);
    try {
        // Fetch enough spans to cover the requested number of traces
        const spans = reader.query({ limit: limit * 50 });
        if (spans.length === 0) {
            if (opts.format === 'sarif') {
                writeOrPrint(formatSarif([], 'agent-trace'), opts.output);
                return;
            }
            if (opts.format === 'junit') {
                writeOrPrint(formatJunit([]), opts.output);
                return;
            }
            console.log(chalk.dim('No traces recorded yet.'));
            console.log(chalk.dim(`DB: ${dbPath}`));
            return;
        }
        const limitedSpans = spans.slice(0, limit * 50);
        if (opts.format === 'sarif') {
            writeOrPrint(formatSarif(limitedSpans, 'agent-trace'), opts.output);
            return;
        }
        if (opts.format === 'junit') {
            writeOrPrint(formatJunit(limitedSpans), opts.output);
            return;
        }
        const traces = groupByTrace(spans).slice(0, limit);
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
    }
    finally {
        reader.close();
    }
}
export const tracesCommand = new Command('traces')
    .description('List recent traces grouped by trace ID')
    .option('-n, --limit <n>', 'Number of traces to show', (v) => parseInt(v, 10), 20)
    .option('--format <format>', 'Output format: sarif or junit')
    .option('--output <file>', 'Write format output to file instead of stdout')
    .action(async (opts) => {
    await runTraces(opts);
});
//# sourceMappingURL=traces.js.map