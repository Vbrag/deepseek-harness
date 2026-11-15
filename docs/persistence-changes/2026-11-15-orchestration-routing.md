---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-15-orchestration-routing

English | [中文](2026-11-15-orchestration-routing.zh.md)

## Summary

Acknowledges the orchestration mode event and the existing todo reconciliation message source declared by the current source tree.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-15-orchestration-routing
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "b2cfa620aded003e20dab4eed1074c94b42bd2c689f422f0adea6fe51b40effd"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "d64de4a2bb4de9a8a0e3711bc2640af31f099c2347a317f00bda85877241b571"
    decision: same-version
  - root: "event:orchestration/mode"
    previous: null
    after: "e217a63abfb41ed4d6d8cbb1ef8501565a69691021fccd271e70738ae06a1c81"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "dd702be63d43a79652c38ce05277a3ecb7965945edaf861b3e07463b8d208eb6"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "4826141ce632215afd02acc78ffe8df4c2d9ba9f2fe0503f4319aee188faa8d6"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid and retain their model-visible content. orchestration/mode is a distinct log-only discriminator; older readers that do not recognize this required event refuse it rather than reinterpret the mode or modify stored generations. The added todo-reconcile source has only a non-empty kind field. Both the prior and current Session restore paths preserve unknown non-empty source kinds and their message content. Routing decisions and queued selections use ignorable plugin records. These additions remain in the current Session format; no committed generation is replaced or deleted.

<a id="verification"></a>
## Verification

The source inventory at HEAD and the working tree have identical root schemas. Four cross-revision restoration probes preserved user and todo-reconcile messages through both Session implementations. The core Session suite passed 640 tests; the focused plugin-record and membership suites passed 31 tests, including the two-module-copy record regression. node node_modules/vitest/vitest.mjs run packages/todo/todo-reconcile-driver/tests passed 10 tests. Task-routing policy tests cover logged and recovered mode selections.

<a id="dev-note"></a>
## Dev Note

None.
