<!-- dsh:project-context:start -->
# DeepSeek Harness project context

Last reconciled with the checkout and conversation on 2026-11-24. This file records the project work, decisions, and verification limits; current source and Git state remain authoritative. DeepSeek Harness is a Cordis plugin-based agent harness. Read [AGENTS.md](AGENTS.md) and [docs/architecture.md](docs/architecture.md) before changing packages, and [docs/AGENTS.md](docs/AGENTS.md) before changing documentation.

## Working constraints and repository state

- The user requested source inspection, source edits, and non-executing Git checks only while the application is running. Do not run tests, compilers, builds, generators, application launches, restarts, or deployments unless the user explicitly lifts that restriction. The user can run commands personally; pasted output does not by itself authorize the assistant to run them.
- Preserve existing work, live profile settings, user model selections, and credentials. Do not reset, rewrite history, or push without explicit authorization. The user requested local commits; hooks were skipped for the provisional implementation to honor the execution restriction.
- Immediately before this context update, the checkout was on master, the latest code commit was 6bb8d4d1eb, the working tree was clean, and the locally stored origin/master was at 5bc2da2f5f. Master was two commits ahead of that cached tracking ref. Check Git again before acting: these facts and the remote state can change, and the remote was not refreshed for this update.
- origin is the user's fork; upstream is the DeepSeek Harness repository. The failed push recorded below is historical and does not establish the current network or hook state.

## Git integration and recent changes

The 2026-11-22 merge combined the local parent f6d2a0052f with incoming parent 4b399c39a6. The initial merge had 54 unresolved paths and thousands of other staged changes; the final staged merge covered 3,249 paths. Merge commit 3dd842e6ba retains both parents and contains the reconciled source and provisional generated artifacts. No unresolved paths were reported after that commit. Earlier work included merge 79e2adb321, the UPB catalog commits, pool persistence commit eaaee2945a, and catalog scoping commit 3456941ebc.

The subsequent commits are:

- 2f4d213619: TPM-aware automatic compaction.
- 5bc2da2f5f: fix the orchestration UI test's split type assertion.
- 431c6c927c: keep the lead orchestrator on the user-selected model.
- 6bb8d4d1eb: fix the possibly undefined route assertion in the orchestration test.

These commits are provisional until the deferred tests, generated files, snapshots, translation records, and runtime checks below are completed. A recoverable merge backup and the detailed workstation-local verification log were recorded under the user's .codex/visualizations/2026/11/22/01a204cb-fcc1-7ea1-b33f-5e7618b3665a directory. The backup is named dsh-merge-backup-20261122T205716Z.zip; do not assume that directory exists on another machine.

## UPB gateway catalog and deployment profiles

The user wants a single maintained University of Paderborn AI-Gateway catalog, its supported chat models available to orchestration, and deployment-specific settings preserved.

- packages/llm/llm-pi-ai/src/upb-gateway-catalog.ts owns UPB_GATEWAY_CATALOG and its dated 2026-11-19 source snapshot. The source contains 41 identifiers: 32 numeric model rows, six routers, and three base aliases. It retains published capacity, quota, pricing, free/paid, modality, and compatibility facts rather than treating catalog labels as live guarantees.
- UPB_CHAT_ROUTE_MODELS selects 25 compatible chat-route entries: 23 direct language or multimodal models, including four Claude models, and two chat aliases. The shipped orchestration profile lists these 25 routes. Responses-interface entries, embeddings, image-generation entries, and incompatible routers are reference data and must not be added to text-chat routing merely because they appear in the catalog.
- The user explicitly wanted the three gateway entries labeled Test available in the route and picker: DeepSeek V4.1 Flash 1017, GLM 5.3, and Mistral Large 4 1T A52B. Their continued availability is not guaranteed. Merely appearing in the catalog or pool does not make one the default model.
- packages/llm/llm-pi-ai/src/upb-gateway.ts derives the shipped upb-ai-gateway route from the catalog. Published input and output capacities remain distinct. RPM and TPM ranges use their lower bound for local pacing. The request output cap is the published maximum capped by TPM divided by published maximum parallelism when those facts exist; common caps in this snapshot are 50,000 and 128,000 tokens. The adapter clamps the configured pacing allowance to the effective request/model cap.
- The orchestration capabilities catalog adds routing specialties and is checked against the gateway facts. Model routing also checks actual provider metadata, context/output capacity, input modalities, explicit reasoning requirements, permissions, availability, and pacing.

The packaged route and a live deployment route can have different identifiers. The previously inspected Web profile used uni-paderborn and supplied an explicit model list, which overrides the packaged model list for that route. packages/llm/llm-pi-ai/scripts/gen-upb-profile.ts updates only the target route's model list while preserving other provider settings and deployment-owned per-model fields such as reasoningEfforts. Its catalog-owned fields are id, name, contextWindow, maxTokens, rpm, tpm, free, and input; it supports --check, --dry-run, --profile, and --route. New model reasoning levels require a deliberate mapping to supported pi-ai levels and may otherwise advertise only off.

An earlier sync dropped reasoningEfforts and caused UNSUPPORTED_REASONING_EFFORT; the profile was restored and the generator changed to retain non-catalog-owned fields. The live profile and its 25-route pool were last reported synchronized on 2026-11-19; their present contents and the running process have not been rechecked in this update. Check the active profile and overrides before changing or diagnosing live settings. Refreshing the packaged catalog alone does not update an explicit live-profile model list.

The detailed source references are paderborn-ai-gateway-dsh-context.md, paderborn-ai-gateway-models.md, packages/llm/llm-pi-ai/src/upb-gateway.ts, and packages/experimental/orchestration-profile/cordis.patch.yml. Never put API keys or credential contents in this file.

## Orchestration, Agent Teams, and user model choices

Orchestration mode and Agent Teams are separate capabilities. Orchestration routes and recovers local subagents using an allowed model pool and task assessment. Agent Teams owns a durable shared-task board and coordination among team members; the Agent teamwork control is not an alias for Orchestration. Their service and UI owners remain separate.

The lead orchestrator uses the model selected for the session, even if that model is outside the child pool. Orchestration must not automatically switch the lead after billing, quota, context, output-limit, or availability failures. A user may select a different model; the existing session model-selection mechanism applies that choice at the next safe step. Existing sessions use their currently recorded selection; historical automatic selections cannot be reliably reclassified as user selections.

Local children retain automatic routing and bounded failover. A child is limited by both the effective pool and its recorded route grant; saving a wider pool must not widen an existing grant. Selection checks task capabilities, modalities, context, output allowance, reasoning requirements, health, and shared pacing. The default maximum is two automatic child reassignments per recovery episode. Explicit assessed phase changes use reassign_subagent/requestModelChange with a checkpoint and preserve the child session.

After a lead failure, normal bounded same-model recovery and compaction can run. Billing exhaustion, irreducible oversized requests, and durability failures are not repeatedly retried. An unbounded provider retry policy is not delegated for lead failure. If recovery cannot continue, the lead records a blocked state and reports a correction or explicit model-selection action. The session and completed tool results remain available for an explicit retry; already completed tools must not be replayed. A prompt blocked by shared billing is recorded before dispatch, and a terminal preparation failure preserves claimed input. The loop's request-error payload excludes input already admitted during same-step repreparation.

The session panel shows lead and child routing progress, the last-used model, and a pending explicit selection. It provides localized lead-blocked and billing-recovery guidance. The routing component is registered in conversation.session.panel.section as orchestration-routing; the old subagent footer slot was retired. Existing sessions and cached projections must be replayed safely; the orchestration routing projection is at state version 3. User-visible behavior and projection recovery remain unverified at runtime.

## Billing and availability recovery

Recorded child runs showed HTTP 422 responses containing the gateway error type budget_exceeded for Anthropic models. The prior adapter path classified those responses as PI_AI_ERROR, so orchestration did not handle the billing failure. At least one affected child had already completed work before a model change. The adapter now classifies structured budget_exceeded and insufficient_funds, and confirmed insufficient-funds wording, as BILLING_EXHAUSTED; HTTP 422 by itself is not a billing classification. Provider failure details continue through the request-error path.

Orchestration keeps billing-health observations shared among concurrent agents within the running service. Existing free/paid model metadata and optional billingBudgetKey identify known-free routes and accounts with an independently configured billing identity. This key is distinct from rateLimitBudgetKey, which groups pacing reservations. Paid routes known to share an exhausted account are suppressed; when independence is unknown, recovery conservatively permits known-free alternatives. Billing health can be reset by the user after correcting the account. The observation is process-local; do not treat it as a durable account ledger or assume another process shares it.

The prepared LLM call exposes detached billing facts from the same adapter generation used for dispatch. The lead's shared-budget admission and the recorded failure's billing scope use those captured facts when available, avoiding a later profile change changing the interpretation of an in-flight request. Unknown facts remain unknown. ORCHESTRATION_BILLING_UNAVAILABLE reports when shared billing health prevents the selected lead route from dispatching. Provider retries remain bounded for the lead; child alternatives remain subject to the configured reassignment limit and recorded permissions.

Relevant owners are packages/llm/llm-pi-ai/src/stream.ts, config.ts, and adapter.ts; packages/llm/llm/src/index.ts; packages/experimental/dsh-orchestration/src/adaptive.ts and adaptive-state.ts; and the orchestration and subagent package READMEs.

## Orchestration pool persistence and picker

The source-level persistence path is: panel draft -> mounted orchestration Remote -> revision-checked settings update -> effective pool -> future routing. The user originally reported that Apply did not reliably update the effective configuration. The prior non-empty save failure's precise cause has not been reproduced against the currently active profile and overrides, so do not claim that the reported live defect has been conclusively verified.

- pool is the shipped/default route list. userPool is a user-owned volatile settings override. userPoolConfigured distinguishes an explicitly saved empty override from an unset one: a legacy non-empty userPool remains valid, an unset empty override inherits the shipped default, and a configured empty pool stays empty.
- getPoolSettingsState returns the effective pool and settings revision. persistPool validates routes, calls the active settings service with userPool and userPoolConfigured against that revision, then checks the effective pool before reporting saved. It returns saved, stale, or failed. A failed effective-value confirmation can occur after a settings write; inspect actual profile state before assuming rollback.
- The picker refreshes the effective pool and catalog when opened, keeps draft selections on failed or rejected saves, reports stale revisions, and disables edits while saving. New catalog rows are not silently selected when an explicit override exists.
- getCatalog uses providers from the union of the shipped pool and effective pool; when neither names a provider it can show all registered providers. This is broader than the older rule that considered only providers already in the effective pool. The catalog supplies choices; the effective pool and recorded child grants govern actual routing.
- The settings panel can reset observed billing health after account correction. Reopening the panel, restarting with the real active profile, and verifying the persisted effective pool and routing behavior are still outstanding.

Relevant owners are packages/experimental/dsh-orchestration/src/index.ts and types.ts, packages/experimental/client-ui-orchestration/src/client/OrchestrationPanel.tsx and mount.ts, and the settings/profile services. Do not write a shipped cordis.patch.yml in place of the user-owned settings mechanism.

## TPM-aware context compaction

The model's context window and its tokens-per-minute request limit are different limits. packages/compaction/compaction-basic checks the fully assembled, frozen request against the captured adapter's per-request estimate before dispatch. The estimate uses the same input projection and output reservation as pi-ai pacing; inspecting it does not reserve capacity. Unknown TPM leaves existing behavior unchanged. Temporary rolling-minute congestion alone is handled by the adapter queue and does not trigger compaction.

Automatic TPM compaction defaults to a 0.9 trigger and a 0.8 target. Both are validated settings available globally and per model through modelPolicies; auto: false disables the automatic path. The existing context-window trigger remains in place. The compactor prunes eligible oversized tool results first, then summarizes balanced older spans while retaining recent context. Summary requests use the configured summarization route, are sized against that route's own budget, may reduce their output cap if needed, and use bounded chunks and the existing compaction retry budget.

A durable surface reduction is flushed before the same turn is reprepared, without duplicating user input or completed tools. When no useful reduction is possible but the request still fits, it proceeds and repeated compaction waits for meaningful growth. If it cannot fit, RATE_LIMIT_REQUEST_TOO_LARGE reaches recovery: an authorized child can use an eligible alternative, while the lead stays on the selected model and reports a blocked state. COMPACTION_DURABILITY_REQUIRED stops admission if a TPM replacement cannot be saved.

The relevant extension and provider owners are packages/core/agent-loop/src/agent.ts, packages/core/agent/src/runtime-types.ts, packages/llm/llm/src/index.ts, packages/llm/llm-pi-ai/src/adapter.ts, and packages/compaction/compaction-basic/src/index.ts. The implementation and focused tests are not yet runtime-verified.

## Verification evidence and known gaps

- During the merge and subsequent source work, the assistant used source inspection and non-executing Git checks, including git diff --check and checks for unresolved paths. The focused tests were added but not run in this phase; no successful end-to-end application, UI, or authenticated provider verification was performed for these changes.
- On 2026-11-23 the user ran pnpm run build with Node v26.12.1. Nine gates passed; the client aggregate check failed with TS1434 in the orchestration UI test. The split type assertion was corrected in commit 5bc2da2f5f. On the later build the client aggregate check passed.
- On 2026-11-24 the user ran pnpm install --no-frozen-lockfile, which reported up to date, and then pnpm run build. Nine gates passed; the host aggregate check failed with TS2345 because a test passed pool[0], which can be undefined, to toMatchObject. Commit 6bb8d4d1eb replaces it with the explicit selected route. The build has not been rerun after that fix, so further diagnostics are unknown.
- Node v26.12.1 is outside the repository's declared engine range, ^24.22.3 || >=26.13.1. Use a supported Node version for later verification. Optional native packages for other operating systems or CPU types can report platform warnings during installation.
- A prior push failed in the Lefthook pre-push hook because Git for Windows Bash could not create an MSYS named object: NtCreateDirectoryObject returned 0xC0000022, and the process exited with 0xc0000142. The typecheck did not start in that attempt. The exact permission cause and current reproducibility are unconfirmed; do not silently bypass pre-push checks.
- Reports of typecheck, artifact build, documentation gates, and package-level checks passing at the older 3456941ebc checkout are historical evidence only. A public catalog endpoint was also reported reachable on 2026-11-19. None validates the later merge or current changes. Earlier sandbox attempts reported spawn EPERM for Vitest/Vite child processes; use the repository's host-sandbox escalation guidance only when a later authorized check actually shows a sandbox failure.

Generated state is not fresh evidence. The merged docs/persistence-schema.json is a provisional manually reconciled inventory and needs review against both merge parents and the repository's persistence-type acknowledgement procedure. The orchestration-pool-recovery and tpm-aware-compaction upgrade-guide pairing records contain placeholders. Other generated catalogs, graph records, translation pairings, snapshots, and SDK/session expectations may be stale. Do not claim these are regenerated or compatible until their owners and checks are reviewed.

## Deferred verification and next actions

Only after the user authorizes execution and, where needed, application launch or restart:

1. Use a supported Node version. Rerun the build after the TS2345 fix and address actual diagnostics. Run focused tests for provider error classification and prepared billing facts, adaptive lead/child recovery, shared budget races and route grants, same-turn input/tool preservation, compaction and TPM limits, pool persistence, stale settings, and UI routing and feedback.

       pnpm exec vitest run packages/llm/llm/tests/service.spec.ts packages/llm/llm-pi-ai/tests/convert.spec.ts packages/llm/llm-pi-ai/tests/adapter.spec.ts packages/core/agent-loop/tests/request-reprepare.spec.ts
       pnpm exec vitest run packages/experimental/dsh-orchestration/tests/adaptive.spec.ts packages/experimental/dsh-orchestration/tests/index.spec.ts packages/experimental/client-ui-orchestration/tests/panel.client.spec.tsx packages/experimental/client-ui-orchestration/tests/mount.client.spec.ts packages/experimental/client-ui-orchestration/tests/routing.client.spec.tsx
       pnpm exec vitest run packages/compaction/compaction-basic/tests/compaction-basic.spec.ts packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts packages/experimental/orchestration-profile/tests/orchestration-profile-boot.spec.ts
       pnpm exec vitest run packages/llm/llm-pi-ai/tests/upb-gateway.spec.ts packages/llm/llm-pi-ai/tests/upb-gateway-catalog.spec.ts packages/llm/llm-pi-ai/tests/gen-upb-profile.spec.ts packages/experimental/dsh-orchestration/tests/capabilities.gate.spec.ts packages/experimental/dsh-orchestration/tests/catalog.spec.ts packages/experimental/orchestration-profile/tests/profile.spec.ts

2. Add keyless recorded-session cases for TPM compaction, blocked lead recovery, an explicit user-selected replacement, and child failover. Update and review TypeScript and Python SDK expectations. Existing orchestration SDK recordings contain the restored lead-model guidance by source inspection; their replay has not been run.

       pnpm run test:snapshot:refresh -t orchestration
       pnpm run test:snapshot -t orchestration
       pnpm run test:snapshot:refresh -t TPM
       pnpm run test:snapshot -t TPM

3. Reconcile the persistence schema and historical formats against both merge parents. Complete the required acknowledgement using docs/cookbook/reviewing-persistence-type-changes.md. Regenerate affected workflow, Cordis API/catalog, config, persistence, documentation graph, and tool catalogs; update and verify bilingual pairing records, including the two provisional upgrade guides. Review generated diffs before staging.

       pnpm run gen-workflow-guest
       pnpm run gen-cordis-catalog
       pnpm run gen-cordis-api
       pnpm run gen-config-catalog
       pnpm run gen-persistence-catalog
       pnpm run gen-doc-graphs
       pnpm run gen-tool-catalog
       pnpm run verify-persistence-changes
       pnpm run verify-upgrade-guides
       pnpm run test:docs
       pnpm run doc-sync
       pnpm run build:artifacts
       pnpm run build:check

4. Once launch or restart is specifically authorized, inspect the actual Web settings and session panel, including narrow and error states. Confirm the active profile's non-empty save, explicit empty pool, reopen/restart persistence, revision conflicts, billing reset, lead model selection, and child routing. Check the active uni-paderborn profile and its deployment-owned reasoning settings rather than assuming the 2026-11-19 live state is still current.
5. Refresh the remote state and follow the repository's pre-push checks before any separately authorized push. Investigate the MSYS access denial if it recurs in a normal interactive environment. Do not expose credentials while diagnosing.
<!-- dsh:project-context:end -->
