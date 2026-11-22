---
kind: upgrade-guide
description: "Prepared LLM calls expose token budgets and automatic compaction considers TPM limits."
---

# Update prepared calls and TPM compaction

English | [中文](guide.zh.md)

## Change

`PreparedLlmCall` now exposes `requestTokenBudget(options)`. Automatic compaction also considers a route's per-minute token limit, and requires durable session storage before continuing after a TPM-driven replacement.

## Migration

1. Add `requestTokenBudget` to custom `PreparedLlmCall` implementations and test doubles; return `undefined` when no token budget is known. Provider adapters can optionally implement the corresponding method on `PreparedAdapterCall`.
2. Review `tpmThresholdRatio` and `tpmTargetRatio` in the `compaction-basic` configuration. Their defaults are `0.9` and `0.8`; model-specific overrides use `modelPolicies`.
3. Ensure session persistence is enabled when TPM compaction is expected. `COMPACTION_DURABILITY_REQUIRED` stops the request if the replacement cannot be saved.
4. After starting the updated application, check that long requests compact or report an actionable limit without repeating completed tools.

Summary failures that produce no text or fail to reduce the selected history now carry `COMPACTION_EMPTY_SUMMARY` or `COMPACTION_INSUFFICIENT_REDUCTION`, respectively. A TPM-driven summary may use a lower output cap when the configured cap cannot fit its route's budget.
