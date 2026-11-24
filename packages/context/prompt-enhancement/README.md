---
description: "One-shot prompt enhancement using bounded project and Session context."
kind: "package-reference"
---

# @deepseek-ai/dsh-prompt-enhancement

English | [中文](README.zh.md)

## Summary

`dsh-prompt-enhancement` prepares a bounded auxiliary model request for a user prompt. Its caller owns consent, presentation, and submission; this service records its exact model request and outcome without starting an Agent turn.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Call `ctx.promptEnhancement.enhance(agent, request, signal)` once for a submission identity. The request supplies the original text, attachment references, selected provider and model, and the captured endpoint identity (`expectedEgress`, or `null` when unknown). A durable request record precedes dispatch; an interrupted record prevents automatic redispatch. The service returns the enhanced text, a length skip, a failure code, cancellation, or an interrupted outcome. Its caller decides whether to submit the original text after a skip or failure.

The service reads a bounded instruction preview and relevant recent user and assistant text. It excludes attachment contents and recognizable credentials. Credential detection cannot identify every secret. Callers must obtain any necessary provider consent and apply their own authorization before invoking the service.

Enhancement events belong to the Session history even when the user cancels before submission. A reader authorized to inspect that history can see the recorded prompt, selected context, and response. The live comparison projection publishes entries only after submission.

The profile-backed `maxPromptWords` and `maxPromptCharacters` settings default to 100 and 2000. Both the displayed prompt and the serialized prompt, including expanded references, must fit. Words are Unicode word-like segments and characters are Unicode code points. Attachment names and selected context do not count toward these two limits. A longer prompt is skipped before provider lookup, context collection, or request recording.

Other configuration defaults are `maxInputBytes: 65536`, `maxContextBytes: 32768`, `maxOutputTokens: 4096`, `maxStreamBytes: 262144`, and `timeoutMs: 30000`. Limits apply to the auxiliary request, independently of the Agent's selected model and output allowance. `enabled` defaults to false; `mode` defaults to `automatic`, and an empty `provider` and `model` use the Session model.

<a id="understand-the-implementation"></a>
## Understand the implementation

The [service](src/index.ts) validates the selected route, persists a request before dispatch, and records the outcome. Its [projection](src/projection.ts) prevents a recorded submission from automatically dispatching a second time. The browser [controls](../../client/ui-prompt-enhancement/README.md) handle profile settings, provider consent, and review.

<a id="further-exploration"></a>
## Further Exploration

- [Instruction loader](../agent-instructions/README.md)
- [Session projections](../../session/session-projection/README.md)

<a id="model-experience"></a>
## Model Experience

### Auxiliary request

#### What the model sees

The model receives the enhancement instruction and a JSON user input with `original`, `context`, and `attachments` fields. Context is data, not an instruction source.

#### Token effect

One enabled attempt can consume one additional model request and its bounded output. The original prompt is not truncated to fit.

#### KV Cache effect

The auxiliary request does not change the main conversation's request prefix. Reuse for the auxiliary call depends on the selected provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Model-generated text can change meaning despite literal validation; callers should offer review.
- Context selection and credential detection are heuristic and cannot establish semantic relevance or detect every secret.
- A Session without a successful durability checkpoint cannot dispatch an enhancement request.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
