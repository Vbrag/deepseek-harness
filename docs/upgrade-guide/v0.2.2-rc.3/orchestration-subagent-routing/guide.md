---
kind: upgrade-guide
description: "Orchestration mode selects models through normal subagent tools and requires a compatible Harness runtime."
---

# Orchestration routes normal subagents

English | [中文](guide.zh.md)

## Change

Orchestration mode assigns normal spawned subagents to suitable models from the selected pool. The `run_orchestration` tool and `@deepseek-ai/dsh-tool-orchestration` package are removed, together with their separate planning, retry, timeout, and concurrency settings. Default mode retains normal model inheritance. The lead agent supplies a structured task assessment when delegating in Orchestration mode.

The orchestration packages require dsh `>=0.2.2-rc.3`. An older installed host cannot load a linked newer plugin safely. Existing sessions and recorded model permissions remain intact; changing the pool does not expand an existing session's permissions.

## Migration

1. Use one compatible Harness installation for the host and linked plugins. For a source checkout, build it with `pnpm run build:artifacts`, then launch from the repository root with `pnpm dsh web --no-open`.
2. Remove `tool-orchestration` rows and dependencies from custom profiles. Move `tool-orchestration.config.pool` to `orchestration.config.pool`. Remove the old `maxConcurrency`, `maxAttemptsPerStep`, and `workerTimeoutMs` settings from that service.
3. Keep the orchestration service and optional Web panel. Select Orchestration mode and delegate through the normal subagent tools; replace custom calls to `orchestrations.run` with normal subagent activation requests carrying a task assessment.
4. Confirm that a new session opens and its first task runs. With Orchestration mode off, confirm normal model inheritance; with it on, confirm the child's recorded route satisfies its task requirements. See the [service reference](../../../../packages/experimental/dsh-orchestration/README.md) for routing configuration and limitations.
