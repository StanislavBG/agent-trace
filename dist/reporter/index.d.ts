/**
 * agent-trace reporter — SARIF 2.1.0 and JUnit XML output
 */
import type { SpanRecord } from '../schema.js';
export declare function formatSarif(spans: SpanRecord[], toolName: string): string;
export declare function formatJunit(spans: SpanRecord[]): string;
//# sourceMappingURL=index.d.ts.map