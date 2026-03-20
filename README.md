# agent-trace

CLI-first local observability for AI agents — OTel GenAI semantics stored in SQLite.

No cloud. No API key. Traces live in `.agent-trace/traces.db` next to your project.

## Install

```bash
npm install -g agent-trace
```

GitHub (pre-release):
```bash
npm install -g github:StanislavBG/agent-trace
```

Or run without installing:

```bash
npx agent-trace record 'claude -p "summarize this file"'
```

## Usage

### Initialize a trace database

```bash
agent-trace init
# Created: .agent-trace/traces.db
```

Run once per project. Subsequent `record` commands auto-find or create the DB.

### Wrap a command with tracing

```bash
agent-trace record 'claude -p "hello"'
agent-trace record 'python my_agent.py'
agent-trace record 'node scripts/run-agent.js'
```

Runs the command, captures a span for its lifetime (start time, end time, exit code), stores to SQLite using [OTel GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

### List traces

```bash
agent-trace traces
# 3 trace(s) — .agent-trace/traces.db
#
# 4fe668b615f8…  1 span  4.9ms   2026-03-20 18:43:29  echo hello
# a1b2c3d4e5f6…  1 span  1.2s    2026-03-20 18:44:01  claude -p "hello"
# 9z8y7x6w5v4u…  2 spans 340ms   2026-03-20 18:45:12  python agent.py
```

### Inspect a trace

```bash
agent-trace show 4fe668b
# Trace: 4fe668b615f834da673efe7acee15d78
# 1 span(s)  total: 4.9ms
#
# ┌ agent.run  OK  4.9ms  cmd=echo hello  agent-trace  exit=0
```

Prefix match — you don't need the full trace ID.

## How it works

- Each `record` invocation creates an OTel trace with a root `agent.run` span
- Span attributes follow GenAI semantic conventions (`gen_ai.system`, `gen_ai.operation.name`)
- A custom `SQLiteSpanExporter` writes synchronously via `SimpleSpanProcessor`
- DB path resolution walks up from cwd (like `git` finding `.git/`)
- All reads are read-only; writes use WAL mode for safety

## Schema

```sql
CREATE TABLE spans (
  id         TEXT PRIMARY KEY,
  trace_id   TEXT NOT NULL,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  start_time INTEGER NOT NULL,  -- nanoseconds since epoch
  end_time   INTEGER NOT NULL,
  status_code INTEGER NOT NULL,
  status_msg  TEXT,
  attributes  TEXT              -- JSON blob
);
```

## Preflight suite integration

agent-trace is part of the **Preflight** suite of local-first developer tools for AI-native workflows. Other Preflight tools can query the same `.agent-trace/traces.db` SQLite database to correlate agent invocations with token usage, latency, and error rates — all on-machine, with no external dependencies.

## Requirements

- Node.js >= 18
- No external services, no accounts, no config files

## License

MIT
