---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-25-orchestration-authorization

English | [中文](2026-11-25-orchestration-authorization.zh.md)

## Summary

Adds required orchestration mode-request, route, routing-state, and child-model authorization events.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-25-orchestration-authorization
baseline: false
changes:
  - root: "event:orchestration/mode-request"
    previous: null
    after: "2ac58dc1b9c294d4f7cb4084dc2394becc9721c84967df1ec01e5a20b46d0f07"
    decision: same-version
  - root: "event:orchestration/route"
    previous: null
    after: "53d20adb6a6db92fbfcbca231413554ead80c5423bd62fa46d3176d6e35d4d53"
    decision: same-version
  - root: "event:orchestration/routing-state"
    previous: null
    after: "76804487236b6d64b7066dcb69ccaacb7bb5d2648d6d993eced04681d502fc6e"
    decision: same-version
  - root: "event:subagent/model-selection-policy-authorized"
    previous: null
    after: "f9c115b631988a873b10319b60ab84612fb792115080acd5d796b423129b560f"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Current readers accept existing Sessions and replay the former ignorable experimental mode and routing records. The new authorization event adds explicitly approved routes; it does not modify existing child grants. A reader without the new event names rejects the required events rather than silently ignoring permissions. The Session header version remains 4 because the event discriminator permits safe refusal.

<a id="verification"></a>
## Verification

The focused orchestration, Session, profile, SDK, and UI suite passed 200 tests. The orchestration-history and adaptive tests passed 57 tests, including old-reader refusal and legacy routing replay. The three keyless orchestration SDK snapshots refreshed successfully.

<a id="dev-note"></a>
## Dev Note

None.
