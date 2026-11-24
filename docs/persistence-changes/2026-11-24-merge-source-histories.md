---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-24-merge-source-histories

English | [中文](2026-11-24-merge-source-histories.zh.md)

## Summary

Reconciles independently recorded message-source histories from the orchestration and SDK branches.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-merge-source-histories
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-16-project-context"
    additionalPrevious: ["2026-11-19-cua-input-notices"]
    after: "5451e3f3137ab466f245221219450913479a572450c13534692535ac31ab011d"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-16-project-context"
    additionalPrevious: ["2026-11-19-cua-input-notices"]
    after: "4ca98b89ce313e87efc1f226b7f591e7d54cc8f004b943f1157450f79a5f3e0e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-16-project-context"
    additionalPrevious: ["2026-11-19-cua-input-notices"]
    after: "a81ca5ae5a4fd5d0f97f5658e485a83d6d5350c548079bfea123b1bc3c8f2313"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-16-project-context"
    additionalPrevious: ["2026-11-19-cua-input-notices"]
    after: "7f824e4f0a7d6293ad6f4ac1a4c86236a063a06599ee2f8799f9a7305c1ed0a7"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The four affected event roots retain the combined source variants and metadata, including SDK time zones, orchestration and project-context attribution, work handoffs, and computer-use notices. Current readers retain the previously recorded source objects. The released V4 reader preserves non-empty producer kinds and their JSON metadata, including kinds it does not interpret; it also preserves the SDK user source and time-zone field. These source records do not change the Session header version or an existing event discriminator. Reader-specific effects remain owned by their producers; this acknowledgement does not assert compatibility for unknown external readers.

<a id="verification"></a>
## Verification

The persistence-history, prompt-enhancement, current-event-admission, and TypeScript SDK projection suites passed 108 tests. The instruction-discovery and released-V4 attribution and message-source suites passed 248 tests with three platform-dependent skips. The V4 checks round-trip representative source values from both histories through all four affected event slots and preserve user and developer message derivation.

<a id="dev-note"></a>
## Dev Note

None.
