#!/usr/bin/env node
import { program } from 'commander';
import { recordCommand } from './commands/record.js';
import { tracesCommand } from './commands/traces.js';
import { showCommand } from './commands/show.js';
import { initCommand } from './commands/init.js';

program
  .name('agent-trace')
  .description('CLI-first observability for AI agents — OTel GenAI semantics stored locally in SQLite')
  .version('0.2.0')
  .addHelpText('after', `
Examples:
  agent-trace init                            create local traces.db (run first)
  agent-trace record 'claude -p "hello"'      wrap any AI command with tracing
  agent-trace traces                          list recent trace sessions
  agent-trace show <traceId>                  inspect full span tree for a trace`);

program.addCommand(recordCommand);
program.addCommand(tracesCommand);
program.addCommand(showCommand);
program.addCommand(initCommand);

program.parseAsync().catch(console.error);
