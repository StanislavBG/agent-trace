# agent-trace

> Local observability for AI agents. No dashboard required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![OTel GenAI](https://img.shields.io/badge/OTel-GenAI%20Semantics-blue)](https://opentelemetry.io/docs/specs/semconv/gen-ai/)

**agent-trace** wraps any AI agent command with [OpenTelemetry GenAI spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/) and stores them in a SQLite database next to your project. Query traces from the terminal. No cloud account. No API key. No running server.

```
agent-trace record 'claude -p "summarize report.txt"'
# agent-trace: recorded trace 4fe668b615f8… → .agent-trace/traces.db

agent-trace traces
# 3 trace(s) — .agent-trace/traces.db
#
# 4fe668b615f8…  1 span  1.2s  2026-03-20 18:43   claude -p "summarize report.txt"
# a1b2c3d4e5f6…  1 span  340ms 2026-03-20 18:40   python my_agent.py

agent-trace show 4fe668b
# ┌ agent.run  OK  1.2s  cmd=claude -p "summarize..."  agent-trace  exit=0
```

## Why agent-trace?

Every other AI observability tool requires a cloud account or a running server:

| Tool | Setup | Data location | Works offline |
|------|-------|---------------|---------------|
| LangSmith | API key + account | LangChain servers | No |
| Langfuse | Postgres server or cloud | Self-hosted or cloud | No |
| Arize Phoenix | Local but dashboard required | Local browser | No |
| Braintrust | API key + account | Cloud only | No |
| **agent-trace** | `npm install` | **Your machine** | **Yes** |

agent-trace is CLI-first by design. Traces are a SQLite file you own. No vendor lock-in. No data leaving your network. Works in air-gapped environments and CI pipelines without external services.

## Install

GitHub (early access — npm package coming soon):
```bash
npm install -g github:StanislavBG/agent-trace
```

**Requirements:** Node.js >= 18. No external services, no accounts, no config files.

## How it works

```
your-project/
├── .agent-trace/
│   └── traces.db          ← SQLite, WAL mode, stays on your machine
└── src/
    └── agent.ts

  agent-trace record 'node dist/agent.js'
       │
       ▼
  ┌─────────────────────────────────────────────┐
  │  OTel SDK (NodeTracerProvider)              │
  │  ┌──────────────────────────────────────┐   │
  │  │ span: agent.run                      │   │
  │  │  gen_ai.system = "agent-trace"       │   │
  │  │  gen_ai.operation.name = "run"       │   │
  │  │  command = "node dist/agent.js"      │   │
  │  │  exit_code = 0                       │   │
  │  └──────────────────────────────────────┘   │
  │  SimpleSpanProcessor                        │
  │  SQLiteSpanExporter ──────────────────────► .agent-trace/traces.db
  └─────────────────────────────────────────────┘
```

- **DB auto-discovery**: walks up from cwd (like git finds `.git/`) — monorepo-friendly
- **OTel GenAI semantics**: standard attribute names — compatible with any OTel-aware tooling
- **Synchronous write**: span is durably stored before `record` exits
- **WAL mode**: safe for concurrent readers while recording is in progress

## Commands

### `init`
Create `.agent-trace/traces.db` in the current directory. Idempotent — safe to run multiple times.

```bash
agent-trace init
# Created: /your/project/.agent-trace/traces.db
```

### `record <command>`
Wrap any shell command with an OTel span. Stores to the nearest `.agent-trace/traces.db` (or creates one in cwd).

```bash
# Claude CLI invocation
agent-trace record 'claude -p "review this PR"'

# Python agent script
agent-trace record 'python scripts/run-agent.py --task summarize'

# Node.js agent
agent-trace record 'node dist/agent.js'

# Any shell command — if it runs an agent, trace it
agent-trace record 'bash pipeline.sh'
```

### `traces [-n <N>]`
List recent traces grouped by trace ID, most recent first.

```bash
agent-trace traces          # last 20 traces (default)
agent-trace traces -n 5     # last 5 traces

# Output:
# 5 trace(s) — .agent-trace/traces.db
#
# 4fe668b615f8…  1 span  1.2s    2026-03-20 18:43  claude -p "review this PR"
# a1b2c3d4e5f6…  3 spans 2.4s    2026-03-20 18:40  python agent.py
# 9z8y7x6w5v4u…  1 span  340ms   2026-03-20 18:35  node dist/agent.js
```

### `show <traceId>`
Display the full span tree for a trace. Accepts a prefix — you don't need the full 32-char ID.

```bash
agent-trace show 4fe668b

# Trace: 4fe668b615f834da673efe7acee15d78
# 1 span(s)  total: 1.2s  db: .agent-trace/traces.db
#
# ┌ agent.run  OK  1.2s  cmd=claude -p "review this PR"  agent-trace  exit=0
```

Multi-span traces show the full parent-child tree:
```bash
agent-trace show a1b2c3

# Trace: a1b2c3d4e5f6...
# 3 span(s)  total: 2.4s
#
# ┌ agent.run  OK  2.4s  cmd=python agent.py  exit=0
#   ├─ agent.step  OK  1.1s  gen_ai.request.model=claude-3-5-sonnet  in=450  out=120
#   ├─ agent.step  OK  1.3s  gen_ai.request.model=claude-3-5-sonnet  in=780  out=89
```

## CI/CD integration

Wrap agent runs in CI to build a persistent trace history without any external service:

```yaml
# .github/workflows/agent.yml
- name: Run agent with tracing
  run: agent-trace record 'node dist/my-agent.js'

- name: Show latest trace
  run: agent-trace traces -n 1
```

Combine with [agent-gate](https://github.com/StanislavBG/agent-gate) to run regression tests, compliance checks, and trace recording as a unified pre-deploy gate.

## SQLite schema

The `.agent-trace/traces.db` file is standard SQLite — query it directly with `sqlite3`, DBeaver, or any SQL client:

```sql
CREATE TABLE spans (
  id          TEXT PRIMARY KEY,
  trace_id    TEXT NOT NULL,
  parent_id   TEXT,              -- null for root spans
  name        TEXT NOT NULL,
  start_time  INTEGER NOT NULL,  -- nanoseconds since epoch
  end_time    INTEGER NOT NULL,
  status_code INTEGER NOT NULL,  -- 1=UNSET, 2=ERROR, 3=OK (OTel status codes)
  status_msg  TEXT,
  attributes  TEXT               -- JSON: gen_ai.* + custom attributes
);
```

Direct SQL queries:
```bash
# All failed agent runs today
sqlite3 .agent-trace/traces.db \
  "SELECT trace_id, attributes FROM spans WHERE status_code=2 AND date(created_at)=date('now')"

# Average run duration
sqlite3 .agent-trace/traces.db \
  "SELECT AVG((end_time - start_time) / 1e9) as avg_seconds FROM spans WHERE parent_id IS NULL"
```

## Part of the Preflight suite

agent-trace is the observability layer in the **Preflight** suite — local-first tools for AI-native CI/CD:

| Tool | What it does |
|------|-------------|
| [stepproof](https://github.com/StanislavBG/stepproof) | Regression testing for AI agent behavior |
| [agent-comply](https://github.com/StanislavBG/agent-comply) | EU AI Act compliance-as-code CLI |
| [agent-shift](https://github.com/StanislavBG/agent-shift) | Safe model migration testing |
| [agent-gate](https://github.com/StanislavBG/agent-gate) | Deployment readiness gate (orchestrates all Preflight tools) |
| **agent-trace** | **Local observability — traces stay on your machine** |

All tools are local-first, CLI-native, zero-config, and work offline.

## License

MIT
