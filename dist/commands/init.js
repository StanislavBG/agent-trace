/**
 * agent-trace init — create .agent-trace/traces.db in cwd.
 * Idempotent.
 */
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { SQLiteSpanExporter } from '../db/exporter.js';
async function runInit() {
    const dir = path.join(process.cwd(), '.agent-trace');
    const dbPath = path.join(dir, 'traces.db');
    const alreadyExists = fs.existsSync(dbPath);
    if (!alreadyExists) {
        fs.mkdirSync(dir, { recursive: true });
    }
    // Opening the exporter runs SCHEMA_SQL (CREATE TABLE IF NOT EXISTS — idempotent)
    const exporter = new SQLiteSpanExporter(dbPath);
    await exporter.shutdown();
    if (alreadyExists) {
        console.log(chalk.dim(`Already exists: ${dbPath}`));
    }
    else {
        console.log(chalk.green(`Created: ${dbPath}`));
    }
}
export const initCommand = new Command('init')
    .description('Create .agent-trace/traces.db in the current directory (idempotent)')
    .action(async () => {
    await runInit();
});
//# sourceMappingURL=init.js.map