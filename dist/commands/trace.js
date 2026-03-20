/**
 * agent-trace trace <traceId> — show all spans in a trace as a tree.
 */
import chalk from 'chalk';
import { TraceReader } from '../db/reader.js';
function formatDuration(ms) {
    if (ms < 1)
        return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000)
        return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
function buildTree(spans) {
    const tree = new Map();
    for (const span of spans) {
        const parent = span.parent_id ?? null;
        if (!tree.has(parent))
            tree.set(parent, []);
        tree.get(parent).push(span);
    }
    return tree;
}
function printTree(tree, parentId, depth) {
    const children = tree.get(parentId) ?? [];
    for (const span of children) {
        const indent = '  '.repeat(depth);
        const prefix = depth === 0 ? '┌ ' : '├─ ';
        const duration = chalk.cyan(formatDuration(span.duration_ms));
        const status = span.status_code === 2 ? chalk.red('ERR') : chalk.green('OK');
        const name = chalk.bold(span.name);
        const attrs = span.attributes;
        const model = attrs['gen_ai.request.model'] ? chalk.yellow(String(attrs['gen_ai.request.model'])) : '';
        const inputTok = attrs['gen_ai.usage.input_tokens'] != null ? `in=${attrs['gen_ai.usage.input_tokens']}` : '';
        const outputTok = attrs['gen_ai.usage.output_tokens'] != null ? `out=${attrs['gen_ai.usage.output_tokens']}` : '';
        const tokens = [inputTok, outputTok].filter(Boolean).join(' ');
        const parts = [name, status, duration];
        if (model)
            parts.push(model);
        if (tokens)
            parts.push(chalk.dim(tokens));
        console.log(`${indent}${prefix}${parts.join('  ')}`);
        printTree(tree, span.id, depth + 1);
    }
}
export function runTrace(traceId, opts) {
    const reader = new TraceReader(opts.db);
    try {
        const spans = reader.getTrace(traceId);
        if (spans.length === 0) {
            console.log(chalk.dim(`No spans found for trace ${traceId}`));
            return;
        }
        if (opts.json) {
            console.log(JSON.stringify(spans, null, 2));
            return;
        }
        const durationMs = spans.length > 0
            ? (spans[spans.length - 1].end_time - spans[0].start_time) / 1e6
            : 0;
        console.log(chalk.bold(`Trace: ${traceId}`));
        console.log(chalk.dim(`${spans.length} span(s)  total: ${formatDuration(durationMs)}`));
        console.log();
        const tree = buildTree(spans);
        printTree(tree, null, 0);
    }
    finally {
        reader.close();
    }
}
//# sourceMappingURL=trace.js.map