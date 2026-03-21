/**
 * agent-trace init — create .agent-trace/traces.db in cwd.
 * Idempotent.
 */

import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { SQLiteSpanExporter } from '../db/exporter.js';

async function runInit(): Promise<void> {
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
  } else {
    console.log(chalk.green(`✔ Created: ${dbPath}`));
    console.log('');
    console.log('agent-trace stores OTel GenAI spans locally — no cloud, no API key.');
    console.log('');
    console.log('Next:');
    console.log(`  ${chalk.cyan('agent-trace record \'your-ai-command\'')}   — wrap any command with tracing`);
    console.log(`  ${chalk.cyan('agent-trace traces')}                      — see what ran`);
    console.log(`  ${chalk.cyan('agent-trace show <traceId>')}              — inspect span tree`);
    console.log('');
    console.log('Works with any CLI tool: claude, openai, langchain, etc.');
    console.log('');
    console.log('Tracing + regression testing = full Preflight pipeline:');
    console.log(`  ${chalk.cyan('npx stepproof init')}`);
  }
}

export const initCommand = new Command('init')
  .description('Create .agent-trace/traces.db in the current directory (idempotent)')
  .action(async () => {
    await runInit();
  });
