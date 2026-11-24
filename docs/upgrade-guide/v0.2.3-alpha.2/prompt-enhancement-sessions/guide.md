---
kind: upgrade-guide
description: "Sessions with prompt enhancement records require an updated Session reader."
---

# Open sessions containing prompt enhancements

English | [中文](guide.zh.md)

## Change

Sessions that use Prompt Enhancement contain new required request, result, and acceptance records. Updated readers retain the original prompt, enhancement, and selected submission. An older reader that does not recognize those records refuses the Session; existing Sessions without these records remain readable.

## Migration

1. Update every application and SDK reader that opens the affected Session to a version that recognizes the `prompt-enhancement/*` events.
2. Preserve a backup of the Session before upgrading or moving it between installations. Keep using the updated reader for Sessions that contain these events; there is no automatic downgrade conversion.
3. For source builds, complete the [persistence-type acknowledgement](../../../cookbook/reviewing-persistence-type-changes.md) and regenerate the Session catalog before enabling the feature. Reopen a Session after an enhanced submission to verify that its original and submitted text remain available.
