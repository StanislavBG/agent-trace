/**
 * agent-trace list — query and display stored spans.
 */
export interface ListOptions {
    db: string;
    limit: number;
    name?: string;
    since?: string;
    json?: boolean;
}
export declare function runList(opts: ListOptions): void;
//# sourceMappingURL=list.d.ts.map