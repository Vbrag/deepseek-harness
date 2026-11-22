---
kind: upgrade-guide
description: "Orchestration pool saves and billing failures use revised results and error codes."
---

# Update orchestration pool clients and billing handling

English | [中文](guide.zh.md)

## Change

`persistPool` accepts a settings revision and returns a structured result instead of a boolean. An explicitly empty user pool disables routing when `userPoolConfigured` is true. Gateway budget exhaustion is reported as `BILLING_EXHAUSTED`.

## Migration

1. Call `getPoolSettingsState` before `persistPool`, pass its non-null revision, and handle the `saved`, `stale`, and `failed` statuses.
2. Set `userPoolConfigured: true` alongside an intentionally empty `userPool`; omit the flag to retain the inherited pool for a legacy empty override.
3. Handle `BILLING_EXHAUSTED` in consumers of model failures. Configure the same `billingBudgetKey` on provider routes only when they share a billing account, and mark a model `free: true` only when its provider confirms it is free.
4. Reopen the Orchestration settings panel and verify the effective pool and save result after the updated application is started.
