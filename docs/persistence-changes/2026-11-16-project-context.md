---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-16-project-context

English | [中文](2026-11-16-project-context.zh.md)

## Summary

Add project-document assessment status, complete original-document observations, and attributed maintenance input.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-16-project-context
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-16-work-continuation"
    after: "254a1fd6191023f9cbe7ea0d7375ee9e10fc8617ccfcf40e828e647fdea4d18b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-16-work-continuation"
    after: "7eb6fd5360a3c2adccc62b3e133a4c4ffdc42da890f08b26f9fb18ed3630adce"
    decision: same-version
  - root: "event:project-context/document-observed"
    previous: null
    after: "7d245e0ce5bdb8b86a8207f9e3989c89e24bd40eff11f15def1fb932861ea1ec"
    decision: same-version
  - root: "event:project-context/status"
    previous: null
    after: "b6cc8e88bd5558480a5c8f08c45a6222027ecd5945b3c5dd561270299f2634be"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-16-work-continuation"
    after: "78ca0fa7fe13d2fb7c3453a70ae2525d5ff7bb4f5153051c4b5f90fcd758c56d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-16-work-continuation"
    after: "b5c12bc35c68edafa8fa88a161a9aa0f9937020426d54481fddab84ad5556f6d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The Session format version remains unchanged. New typed event discriminators are required on read, so older readers refuse unfamiliar records instead of treating incomplete documentation as finalized. Maintenance input adds a distinct message-source variant; existing histories remain readable. Projection replay retains status without filesystem effects or transferred write authority.

<a id="verification"></a>
## Verification

Focused projection and driver tests cover checkpoint suffix replay, child isolation, current-turn recovery, interrupted maintenance, and unchanged task and goal continuation semantics. TypeScript and Python SDK event consumers retain the new typed records.

<a id="dev-note"></a>
## Dev Note

None.
