<!-- dsh:project-context:start -->
# DeepSeek Harness project context

Last reconciled with the checkout and conversation on 2026-11-25. This file records the project work, decisions, and verification limits; current source and Git state remain authoritative. DeepSeek Harness is a Cordis plugin-based agent harness. Read [AGENTS.md](AGENTS.md) and [docs/architecture.md](docs/architecture.md) before changing packages, and [docs/AGENTS.md](docs/AGENTS.md) before changing documentation.

## Working constraints and repository state

- The earlier source-inspection-only restriction was lifted for completing Prompt Enhancement: the user authorized generators, tests, builds, UI verification, a local commit, and an app restart if needed. No push was authorized for this work.
- Preserve existing work, live profile settings, user model selections, and credentials. Do not reset or rewrite history. Run normal commit hooks unless the user authorizes a specific exception.
- The working branch is master. The Prompt Enhancement implementation began from a clean checkout containing its earlier provisional commit; inspect current Git status and tracking refs before acting because both can change.
- origin is the user's fork; upstream is the DeepSeek Harness repository. The failed push recorded below is historical and does not establish the current network or hook state.

## Git integration and recent changes

The 2026-11-22 merge retained both parents after reconciling 54 unresolved paths and thousands of other staged changes. Four Session persistence roots later needed a history reconciliation. An explicit multi-predecessor record now joins the independent tips; the original records, snapshots, and finalized checkpoint remain intact.

The subsequent commits are:

- TPM-aware automatic compaction.
- Fixes for the orchestration UI test's split type assertion and the possibly undefined route assertion.
- Selection of the user-chosen model for the lead orchestrator.
- A provisional Prompt Enhancement implementation, followed by the current completion work.

The merge and TPM changes were initially provisional while execution was restricted. Later work ran the checks recorded below; the active UPB profile has not been retested in the latest task. A recoverable merge backup and the detailed workstation-local verification log were recorded under the user's .codex/visualizations/2026/11/22/01a204cb-fcc1-7ea1-b33f-5e7618b3665a directory. The backup is named dsh-merge-backup-20261122T205716Z.zip; do not assume that directory exists on another machine.

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

The session panel shows lead and child routing progress, the last-used model, and a pending explicit selection. It provides localized lead-blocked and billing-recovery guidance. The routing component is registered in conversation.session.panel.section as orchestration-routing; the old subagent footer slot was retired. Existing sessions and cached projections must be replayed safely; the orchestration routing projection is at state version 4. Focused tests cover legacy routing records and older checkpoints.

The base profile mounts the Orchestration service default-off and the Web application mounts its composer switch beside Prompt Enhancement in main conversations only. First use opens the pool editor when needed. Turning on the switch authorizes and captures the current pool for that activation without a separate review dialog. New models require off/on to become eligible; removed models immediately leave eligibility for new work and recovery, even if re-added during the activation. Running workers retain their grants. Sessions created before activation snapshots require off/on before new orchestrated work. Checkpoints are durable; failed checkpoints block new delegations until storage is retried. The optional Paderborn profile configures the existing service and retains its gateway pool and compaction defaults. The service and Web client live under packages/subagent/orchestration and packages/client/ui-orchestration; the fork maintainer owns them.

## Billing and availability recovery

Recorded child runs showed HTTP 422 responses containing the gateway error type budget_exceeded for Anthropic models. The prior adapter path classified those responses as PI_AI_ERROR, so orchestration did not handle the billing failure. At least one affected child had already completed work before a model change. The adapter now classifies structured budget_exceeded and insufficient_funds, and confirmed insufficient-funds wording, as BILLING_EXHAUSTED; HTTP 422 by itself is not a billing classification. Provider failure details continue through the request-error path.

Orchestration keeps billing-health observations shared among concurrent agents within the running service. Existing free/paid model metadata and optional billingBudgetKey identify known-free routes and accounts with an independently configured billing identity. This key is distinct from rateLimitBudgetKey, which groups pacing reservations. Paid routes known to share an exhausted account are suppressed; when independence is unknown, recovery conservatively permits known-free alternatives. Billing health can be reset by the user after correcting the account. The observation is process-local; do not treat it as a durable account ledger or assume another process shares it.

The prepared LLM call exposes detached billing facts from the same adapter generation used for dispatch. The lead's shared-budget admission and the recorded failure's billing scope use those captured facts when available, avoiding a later profile change changing the interpretation of an in-flight request. Unknown facts remain unknown. ORCHESTRATION_BILLING_UNAVAILABLE reports when shared billing health prevents the selected lead route from dispatching. Provider retries remain bounded for the lead; child alternatives remain subject to the configured reassignment limit and recorded permissions.

Relevant owners are packages/llm/llm-pi-ai/src/stream.ts, config.ts, and adapter.ts; packages/llm/llm/src/index.ts; packages/subagent/orchestration/src/adaptive.ts and adaptive-state.ts; and the orchestration and subagent package READMEs.

## Orchestration pool persistence and picker

The persistence path is: panel draft -> mounted orchestration Remote -> revision-checked active-profile settings update -> confirmed effective pool and specialties -> future routing. An isolated Web profile reproduced a false failure after a successful write: the confirmation compared object key order. Structural comparison now confirms equivalent objects correctly. Higher-priority home patches and command-line overlays can refuse a profile write; the panel preserves the draft and reports the failure. The user's live profile was not changed.

- pool is the shipped/default route list. userPool is a user-owned volatile settings override. userPoolConfigured distinguishes an explicitly saved empty override from an unset one: a legacy non-empty userPool remains valid, an unset empty override inherits the shipped default, and a configured empty pool stays empty.
- getPoolSettingsState returns the effective pool and settings revision. persistPool validates routes, calls the active settings service with userPool, userPoolConfigured, and membership identities against that revision, then checks the effective values before reporting saved. It returns saved, stale, or failed. A failed effective-value confirmation can occur after a settings write; inspect actual profile state before assuming rollback.
- The picker refreshes the effective pool and catalog when opened, keeps draft selections on failed or rejected saves, reports stale revisions, and disables edits while saving. New catalog rows are not silently selected when an explicit override exists.
- getCatalog lists models from all registered providers. Users can save specialties for exact routes; those overrides replace curated or deployment specialties and remain subject to actual modality limits. The effective pool and recorded child grants govern routing.
- The settings panel can reset observed billing health after account correction. The pool and its membership identities belong to the active profile; each Session records the activation snapshot that constrains later child routing.

Relevant owners are packages/subagent/orchestration/src/index.ts and types.ts, packages/client/ui-orchestration/src/client/OrchestrationPanel.tsx and mount.ts, and the settings/profile services. Do not write a shipped cordis.patch.yml in place of the user-owned settings mechanism.

## TPM-aware context compaction

The model's context window and its tokens-per-minute request limit are different limits. packages/compaction/compaction-basic checks the fully assembled, frozen request against the captured adapter's per-request estimate before dispatch. The estimate uses the same input projection and output reservation as pi-ai pacing; inspecting it does not reserve capacity. Unknown TPM leaves existing behavior unchanged. Temporary rolling-minute congestion alone is handled by the adapter queue and does not trigger compaction.

Automatic TPM compaction defaults to a 0.9 trigger and a 0.8 target. Both are validated settings available globally and per model through modelPolicies; auto: false disables the automatic path. The existing context-window trigger remains in place. The compactor prunes eligible oversized tool results first, then summarizes balanced older spans while retaining recent context. Summary requests use the configured summarization route, are sized against that route's own budget, may reduce their output cap if needed, and use bounded chunks and the existing compaction retry budget.

A durable surface reduction is flushed before the same turn is reprepared, without duplicating user input or completed tools. When no useful reduction is possible but the request still fits, it proceeds and repeated compaction waits for meaningful growth. If it cannot fit, RATE_LIMIT_REQUEST_TOO_LARGE reaches recovery: an authorized child can use an eligible alternative, while the lead stays on the selected model and reports a blocked state. COMPACTION_DURABILITY_REQUIRED stops admission if a TPM replacement cannot be saved.

The relevant extension and provider owners are packages/core/agent-loop/src/agent.ts, packages/core/agent/src/runtime-types.ts, packages/llm/llm/src/index.ts, packages/llm/llm-pi-ai/src/adapter.ts, and packages/compaction/compaction-basic/src/index.ts. The implementation and focused tests are not yet runtime-verified.

## Prompt enhancement

Prompt Enhancement is an optional composer feature, off by default. It prepares one bounded auxiliary model request using the user's prompt, relevant instruction sections, recent conversation text, and attachment names; attachment contents are not sent to the enhancer. Automatic submission and review/edit modes are available. Slash commands, empty and attachment-only inputs, and direct child chats bypass the feature. The chosen lead model, orchestration pool, and child route grants are independent of the enhancement settings.

The active profile stores the enabled state, mode, optional dedicated model, provider approvals, and prompt limits through revision-aware settings. A prompt is eligible only when both its displayed and serialized text, including expanded references, fit the configured limits. Defaults are 100 Unicode word-like segments and 2,000 Unicode code points, inclusive. Attachment names and optional contextual text do not count toward these two limits. Longer prompts are submitted unchanged with a localized notice; no enhancement model lookup, consent request, or auxiliary call occurs.

The host records the exact auxiliary request before dispatch and records its settlement and admitted text in the Session. It refuses duplicate dispatch for the same submission identity. Provider consent is saved for a known endpoint and applies only to the current submission when endpoint identity is unknown. A failed enhancement uses the original; cancellation preserves the draft. Recognizable credentials are excluded, but secret detection and meaning preservation are heuristic. Session readers can inspect the raw prompt, selected context, and response even if submission is cancelled. An older reader that does not recognize the new required events refuses the Session; see the prompt-enhancement upgrade guide.

The host implementation is in packages/context/prompt-enhancement, and the composer and settings controls are in packages/client/ui-prompt-enhancement. The Session event catalog, Remote metadata, configuration and client catalogs, and focused bilingual records have been regenerated. The three required events have a persistence acknowledgement in docs/persistence-changes/2026-11-24-prompt-enhancement-events.md.

## Verification evidence and known gaps

- With Node v24.22.3, the full build passed all 10 gates after the history-tool and Windows path fixes. A subsequent aggregate build check passed both gates after the final history regression was added. Run the aggregate check again if source or included tests change.
- The focused Prompt Enhancement, client conversation, Chat, LLM, billing-health, egress, and Session snapshot-normalization run passed 357 tests. A later focused run passed 143 tests after source cleanup, and the corrected controller suite passed seven tests. Separate instruction-preview, TypeScript SDK, Python SDK, and recorded-Session corpus checks also passed. The isolated Web scenario exercised saved limit settings, automatic enhancement, an unchanged over-limit submission, the skip notice, review cancellation, persistence flush, and browser reload. It recorded and replayed a synthetic Session using scenario-owned instructions. The desktop light/dark review states and a narrow settings view were visually inspected. This was a keyless replay, not an authenticated provider test.
- The persistence, documentation-site, Agent Note archive, instruction-discovery, and released-V4 compatibility regression run passed 415 tests with three platform-dependent skips. The complete persistence checker reports 81 roots matching 37 history records.
- Documentation synchronization passed all 43 gates after the history reconciliation and Windows junction fixes.
- Instruction-discovery fixtures now isolate temporary workspaces even when the available temporary directory is inside this checkout. On this Windows host, two file-symlink cases are skipped when the account lacks permission; a separate pre-existing POSIX chmod case is also skipped.
- The history checker validates each reconciliation predecessor, rejects unjoined forks and dependent parents, and locks all predecessors in later finalization checkpoints. Its focused tests cover both branch preservation and checkpoint tampering; V4 reader tests cover the affected message slots and representative sources from both branches.
- The affected LLM runtime, pi-ai adapter, and DeepSeek provider suites passed 1,613 tests. Their Loader fixture uses current workspace manifests instead of installed package metadata from an enclosing checkout. The egress and billing-health helpers use the dedicated @deepseek-ai/dsh-llm/egress and @deepseek-ai/dsh-llm/billing-health entry points.
- The earlier plugin-entry export and repository-wide lint issues were addressed in the subsequent lint and plugin-entry cleanup commit. Re-run the relevant gates after later source changes.
- Ten untracked directories containing only leftover lib and node_modules artifacts were moved to .artifacts/hygiene-residue-20261124 inside this checkout. Restore a directory from that backup if an older local process still needs it.
- The orchestration-focused suite passed 200 tests, three keyless SDK/Session snapshots were refreshed, and 57 compatibility and adaptive-routing tests passed. The active UPB profile remains unverified in this task.
- A prior push failed before typechecking when Git for Windows Bash could not create an MSYS named object. The present cause and reproducibility are unknown. The system Node v26.12.1 is outside this repository's declared engine range; the verification above used an isolated supported Node runtime.

## Next actions

1. Verify the active UPB profile and provider behavior when live-profile testing is in scope.
2. Investigate the prior Windows push-hook failure if it recurs. Do not push without a separate request.

<!-- dsh:project-context:end -->
