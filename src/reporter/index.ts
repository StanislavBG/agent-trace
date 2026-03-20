/**
 * agent-trace reporter — SARIF 2.1.0 and JUnit XML output
 */

import type { SpanRecord } from '../schema.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDurationMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Group spans by trace_id, preserving insertion order of first encounter */
function groupByTraceId(spans: SpanRecord[]): Map<string, SpanRecord[]> {
  const groups = new Map<string, SpanRecord[]>();
  for (const span of spans) {
    if (!groups.has(span.trace_id)) groups.set(span.trace_id, []);
    groups.get(span.trace_id)!.push(span);
  }
  return groups;
}

function spanErrorMessage(span: SpanRecord): string {
  const durationStr = formatDurationMs(span.duration_ms);
  const parts: string[] = [`span "${span.name}" failed in ${durationStr}`];

  if (span.status_msg) parts.push(`status: ${span.status_msg}`);

  const attrs = span.attributes;
  if (attrs['error.message']) parts.push(`error: ${String(attrs['error.message'])}`);
  if (attrs['exit_code'] != null) parts.push(`exit_code: ${String(attrs['exit_code'])}`);
  if (attrs['gen_ai.request.model']) parts.push(`model: ${String(attrs['gen_ai.request.model'])}`);

  return parts.join(', ');
}

function spanSummary(span: SpanRecord): string {
  const durationStr = formatDurationMs(span.duration_ms);
  const parts: string[] = [`span "${span.name}" (${durationStr})`];

  const attrs = span.attributes;
  if (attrs['gen_ai.system']) parts.push(`system: ${String(attrs['gen_ai.system'])}`);
  if (attrs['gen_ai.request.model']) parts.push(`model: ${String(attrs['gen_ai.request.model'])}`);
  if (attrs['command']) parts.push(`cmd: ${String(attrs['command']).slice(0, 60)}`);

  return parts.join(', ');
}

// ── SARIF ─────────────────────────────────────────────────────────────────────

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: { text: string };
  locations?: Array<{
    logicalLocations: Array<{ name: string; kind: string }>;
  }>;
}

interface SarifLog {
  version: string;
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }>;
}

export function formatSarif(spans: SpanRecord[], toolName: string): string {
  const groups = groupByTraceId(spans);

  // Each traceId becomes a rule
  const rules: SarifRule[] = [];
  const results: SarifResult[] = [];

  for (const [traceId, traceSpans] of groups) {
    const shortId = traceId.slice(0, 12);
    const ruleId = `trace-${shortId}`;

    const rootSpan = traceSpans.find(s => s.parent_id == null) ?? traceSpans[0];
    const rootName = rootSpan?.name ?? 'unknown';
    const hasErrors = traceSpans.some(s => s.status_code === 2);

    rules.push({
      id: ruleId,
      name: `Trace${shortId.replace(/-/g, '')}`,
      shortDescription: {
        text: `Trace ${traceId} — root span: "${rootName}"${hasErrors ? ' (contains errors)' : ''}`,
      },
    });

    for (const span of traceSpans) {
      const isError = span.status_code === 2;
      const message = isError ? spanErrorMessage(span) : spanSummary(span);

      results.push({
        ruleId,
        level: isError ? 'error' : 'none',
        message: { text: message },
        locations: [
          {
            logicalLocations: [
              { name: traceId, kind: 'module' },
            ],
          },
        ],
      });
    }
  }

  const sarif: SarifLog = {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: '0.2.0',
            informationUri: 'https://github.com/StanislavBG/agent-trace',
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}

// ── JUnit XML ─────────────────────────────────────────────────────────────────

export function formatJunit(spans: SpanRecord[]): string {
  const groups = groupByTraceId(spans);
  const timestamp = new Date().toISOString();

  const suiteParts: string[] = [];
  let totalTests = 0;
  let totalFailures = 0;

  for (const [traceId, traceSpans] of groups) {
    const suiteFailures = traceSpans.filter(s => s.status_code === 2).length;
    const suiteTests = traceSpans.length;
    totalTests += suiteTests;
    totalFailures += suiteFailures;

    const caseParts: string[] = [];

    for (const span of traceSpans) {
      const caseName = escapeXml(span.name);
      const className = escapeXml(`agent-trace.${traceId.slice(0, 12)}`);
      const durationSec = (span.duration_ms / 1000).toFixed(6);
      const isError = span.status_code === 2;

      if (isError) {
        const msg = escapeXml(spanErrorMessage(span));
        caseParts.push(
          `      <testcase name="${caseName}" classname="${className}" time="${durationSec}">\n` +
          `        <failure message="${msg}" type="SpanError">${msg}</failure>\n` +
          `      </testcase>`,
        );
      } else {
        caseParts.push(
          `      <testcase name="${caseName}" classname="${className}" time="${durationSec}"/>`,
        );
      }
    }

    suiteParts.push(
      `  <testsuite name="${escapeXml(traceId)}" tests="${suiteTests}" failures="${suiteFailures}" timestamp="${timestamp}" time="0">\n` +
      caseParts.join('\n') + '\n' +
      `  </testsuite>`,
    );
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="agent-trace" tests="${totalTests}" failures="${totalFailures}" time="0">`,
    ...suiteParts,
    '</testsuites>',
    '',
  ];

  return lines.join('\n');
}
