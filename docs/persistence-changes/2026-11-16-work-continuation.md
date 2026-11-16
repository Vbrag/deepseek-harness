---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-16-work-continuation

English | [中文](2026-11-16-work-continuation.zh.md)

## Summary

Adds durable todo authorization, completion-repair counters, and resumable work handoffs.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-16-work-continuation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-15-orchestration-routing"
    after: "aea3ddadd7e8ab98fdf3acdb2c35f09965ab871e55cc69cb1c0584ebed547d68"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-15-orchestration-routing"
    after: "159c87abe3f3afa8e713d0d6ac07e8082e2f8631e1c1a4a245c67bd7ef087168"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-15-orchestration-routing"
    after: "3ede2a830728d60556d83e6c66e768cc03bacd5daf8cc85d7723ce29c342da32"
    decision: same-version
  - root: "event:todo/policy"
    previous: null
    after: "55a59125c15d762eb8f31c9be30724690159094ce1c5c186997dedbab71607f0"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-15-orchestration-routing"
    after: "59b86335bb751049176567b2ce4d9f5c84cda06f1b6839b5c8298be8c5abc5ac"
    decision: same-version
  - root: "event:work-handoff/captured"
    previous: null
    after: "1bbc75e2b064894e604f66ea577690b0d23c26bfcaf6cbac2d5755dd9cd1455f"
    decision: same-version
  - root: "event:work-handoff/checkpoint"
    previous: null
    after: "d2363bc4dc1cc6d1b751e6f37424e84b5636f6268073e16c1bff81c26710faf6"
    decision: same-version
  - root: "event:work-handoff/cleared"
    previous: null
    after: "1abfbe7652bb34115d53f5b0fc07b30149472cdffbf608b01c800781f9201d54"
    decision: same-version
  - root: "event:work-handoff/imported"
    previous: null
    after: "7baf2baf2c611d74c9ff3d3ef30d6ea78c478646aca3ce74922e0d98d580ce50"
    decision: same-version
  - root: "event:work-handoff/saved"
    previous: null
    after: "23d46302319c899792296daef52877199b09a21c07e19338ce22aa2cf6452d19"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing todo/write and goal records are unchanged. New readers treat unclassified legacy lists as requiring human continuation. New required todo/policy and work-handoff events make older readers refuse unsupported work state safely. The additive work-handoff message source preserves logged content; source-agnostic readers retain it and do not execute continuation from its attribution. No existing event discriminator changes meaning.

<a id="verification"></a>
## Verification

Focused work-handoff projection, Markdown, seed-parser, and live AgentFactory service tests passed (27 tests). Todo policy and continuation tests cover legacy authority, bounded repairs, progress, cancellation, and goal ownership. Core stopping-cause tests preserve turn/end semantics.

<a id="dev-note"></a>
## Dev Note

None.
