---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-24-prompt-enhancement-events

English | [中文](2026-11-24-prompt-enhancement-events.zh.md)

## Summary

Records the auxiliary prompt-enhancement request, result, and accepted submission in the Session.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-prompt-enhancement-events
baseline: false
changes:
  - root: "event:prompt-enhancement/accepted"
    previous: null
    after: "0076b75b21ecc92d24978c528c3e2ed86250249b238c3ca7a1c3013040a19a9a"
    decision: same-version
  - root: "event:prompt-enhancement/request"
    previous: null
    after: "61d73c7de4357103cb5842ebdd1300497f546218599769f06586b5ddbf874049"
    decision: same-version
  - root: "event:prompt-enhancement/result"
    previous: null
    after: "e67cc98dbed015a6f5d870a5f7147291342e26053094a8b9ddca25be49d73004"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Sessions contain none of these required event types and remain readable without enhancement. Current readers recognize their distinct discriminators and preserve the recorded request, result, and selected text. Earlier readers that do not recognize a required event refuse a Session containing it before execution, mutation, or recovery truncation; they do not reinterpret the event. The Session header version and existing event meanings are unchanged. The records can contain raw prompt text, selected context, and the auxiliary response, so anyone authorized to read the Session can inspect them.

<a id="verification"></a>
## Verification

The persistence-history, prompt-enhancement, current-event-admission, and TypeScript SDK projection suites passed 108 tests. The admission suite checks refusal of unknown required events without truncating stored data. The prompt-enhancement projection is also covered by the Python SDK expectation and the keyless Web Session replay.

<a id="dev-note"></a>
## Dev Note

None.
