---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-25-orchestration-pool-snapshot

English | [中文](2026-11-25-orchestration-pool-snapshot.zh.md)

## Summary

Records the selected pool membership identities for each orchestration activation.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-25-orchestration-pool-snapshot
baseline: false
changes:
  - root: "event:orchestration/pool-snapshot"
    previous: null
    after: "b6ae9be32d8f1971015bc524b8d1dbda437bce855e9a3ff79c67f156a9b2d611"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Current readers retain earlier mode records and require reactivation before new routing when no snapshot exists. Older readers reject the new required event instead of interpreting an unrestricted pool. Existing workers and recorded permissions are retained.

<a id="verification"></a>
## Verification

The focused orchestration, client, profile and Session compatibility suite passed 186 tests, including old-reader refusal and pool removal and re-addition.

<a id="dev-note"></a>
## Dev Note

None.
