---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-17-running-child-model-policy

English | [中文](2026-11-17-running-child-model-policy.zh.md)

## Summary

Adds a child-owned immutable running-model grant for authorized model changes within a local child Session. Orchestration phase requests and bounded recovery state use the existing ignorable plugin-record representation and a validated projection.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-17-running-child-model-policy
baseline: false
changes:
  - root: "event:subagent/running-model-policy"
    previous: null
    after: "3c4824c63e6bbbdf03636a2c674fe0ade5a741b3ed6a62e9ecd60b6141f8804d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The Session version is unchanged. New readers accept historical logs without this grant and restrict those children to their original route until an authorized ancestor records the direct parent's saved authorization. Fork-inherited grants are ignored, and later records cannot widen the first child-owned grant. Older readers that do not recognize the required subagent/running-model-policy event refuse it before execution, mutation, or recovery truncation rather than skip an authority constraint. Routing-state plugin records remain ignorable opaque JSON for readers without that plugin; the new projection validates increasing revisions, and replay alone neither authorizes nor applies a model change.

<a id="verification"></a>
## Verification

node --import tsx/esm node_modules/vitest/vitest.mjs run packages/session/session-persistence-jsonl/tests/current-event-admission.spec.ts packages/core/session/tests/canonical-envelopes.spec.ts --reporter=dot: 253 tests passed, covering unknown-required refusal without truncation and opaque ignorable-record retention. The passing 78-test runtime suite includes subagent model-change and reassign-model coverage; dsh-orchestration/tests/adaptive.spec.ts passed 10 tests covering phase and recovery state.

<a id="dev-note"></a>
## Dev Note

None.
