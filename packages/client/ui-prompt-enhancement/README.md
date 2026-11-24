---
description: "Composer and settings controls for prompt enhancement."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-prompt-enhancement

English | [中文](README.zh.md)

## Summary

This browser plugin presents the Prompt Enhancement switch, model and review settings, provider consent, and a comparison above admitted prompts. The host [prompt-enhancement service](../../context/prompt-enhancement/README.md) owns the request, validation, and Session records.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The composer switch is off by default and saves its state in the active profile. Choose automatic submission or review, and optionally choose a registered model in settings. Review allows editing the proposed text or using the original. Cancelling keeps the composer draft. Commands, empty submissions, attachment-only submissions, and direct child chats do not invoke enhancement.

An enhancement attempt may record the original prompt, selected context, and response in Session history before submission, including when cancelled. Anyone authorized to read that history can inspect the records.

When a dedicated route uses a different provider endpoint, the composer asks before sending context. A stable endpoint approval is saved in the profile; an endpoint without a stable identity requires approval for each submission. Settings can clear saved approvals. A failed attempt uses the original and displays a notice.

<a id="understand-the-implementation"></a>
## Understand the implementation

The [controller](src/client/controller.ts) coordinates one frozen composer submission, its cancellation, and profile settings. The [mount](src/client/mount.ts) connects it to Conversation and Chat slots.

<a id="further-exploration"></a>
## Further Exploration

- [Conversation input](../ui-conversation/README.md)
- [Chat](../ui-chat/README.md)

<a id="model-experience"></a>
## Model Experience

### Auxiliary request

#### What the model sees

The browser sends the original prompt and attachment names to the host; it does not send attachment contents to the enhancement model. The host supplies the bounded contextual material described in its [package reference](../../context/prompt-enhancement/README.md).

#### Token effect

An enabled attempt can add one bounded model request.

#### KV Cache effect

The auxiliary request does not alter the main conversation prefix.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Highlighting marks the changed span and may include unchanged words between separate edits.
- A model-generated rewrite can change meaning; review mode lets the user edit it before submission.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
