---
kind: upgrade-guide
description: "Orchestration pool saves, billing failures, and lead-model recovery have changed."
---

# Update orchestration pool clients and billing handling

English | [中文](guide.zh.md)

## Change

`persistPool` accepts a settings revision and returns a structured result instead of a boolean. An explicitly empty user pool disables routing when `userPoolConfigured` is true. Gateway budget exhaustion is reported as `BILLING_EXHAUSTED`. The lead retains the session's selected model instead of automatically switching during recovery; a shared budget that blocks its dispatch reports `ORCHESTRATION_BILLING_UNAVAILABLE`. Local children can still switch within their authorized pool.

## Migration

1. Call `getPoolSettingsState` before `persistPool`, pass its non-null revision, and handle the `saved`, `stale`, and `failed` statuses.
2. Set `userPoolConfigured: true` alongside an intentionally empty `userPool`; omit the flag to retain the inherited pool for a legacy empty override.
3. Handle `BILLING_EXHAUSTED` and `ORCHESTRATION_BILLING_UNAVAILABLE` in consumers of model failures. Configure the same `billingBudgetKey` on provider routes only when they share a billing account, and mark a model `free: true` only when its provider confirms it is free.
4. Reopen the Orchestration settings panel and verify the effective pool and save result after the updated application is started.
5. If the lead model is blocked, correct the reported issue and retry, or select another model in the composer. Reset billing health in model-pool settings after correcting an exhausted account.
