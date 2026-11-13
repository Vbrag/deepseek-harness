# Runbook: handling AI‑Gateway token rate limits — safeguards & recovery

**Applies to:** DeepSeek Harness runs routed through the Paderborn AI‑Gateway (`uni-paderborn`) models such as `gwdg.deepseek-v4-flash-0731`.
**Triggered by:** the 2026‑11‑05 stop of session `session-9f364de9` (Westertor continuity), where repeated **HTTP 429 token‑limit** errors ended turn 2 mid‑task instead of finishing the reference document.
**Goal:** (1) a reliable *wait‑and‑retry* strategy, and (2) safeguards so a model‑budget stall no longer silently ends a long run without its deliverable.

---

## 1. What actually happened (why retry alone didn’t save the run)

The harness retries model requests through `dsh-llm-retry`. The policy in effect for this run was (read from the session log):

```
mode: normal
retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]
maxRetries: 500
initialDelayMs / maxDelayMs: ..., 60000   (60 s cap)
jitterRatio: 0.1
```

Three facts made the retries ineffective (all verified in this repo’s `packages/llm/llm-retry/src/index.ts`):

1. **The backoff is capped at 60 s** (`Math.min(exponential*jitter, maxDelayMs)`), but the gateway’s token budget resets on a much longer cycle. So the agent woke every ~60 s, issued a fresh model call, got throttled again — and kept **consuming tokens each attempt** (Remaining fell 316 431 → 311 292 → 310 858 → 310 459 per attempt), making the stall self‑reinforcing.
2. **`Retry-After` is only honored if it is ≤ `maxDelayMs` and the failure exposes a positive `providerRetryAfterMs`.** When the gateway’s `Retry-After` exceeds the 60 s cap, `normal` mode **gives up on that step immediately** (`return next()`). So a server-advised longer wait is *not* followed.
3. The run was in **autonomous/orchestration continuation**: each new step needed the model, so there was no human pacing to absorb the reset window.

**Net effect:** the “wait and retry” the harness already had was too short‑sighted, so the run burned its budget and ended (`turn/end` 09:22:06) with the deliverable unwritten — not a crash, but a budget‑exhaustion stall.

## 2. Immediate recovery (what to do right now)

1. **Confirm the budget window.** The gateway said the bucket resets after the period rate‑limiter elapses. Until then, do **not** send more model requests from the same `model_per_key`; every attempt shortens future headroom.
2. **Wait, then resume with a single explicit continuation.** In the session GUI select the stopped session and send **“continue”** (or “resume”). Turn 3 picks up the goal/to‑do list where turn 2 left off.
3. **Reduce the work‑face first** so a single resumed turn finishes the big remaining deliverable before budget is spent again: e.g., ask it to *first* write the `CHAT_SESSION_REFERENCE_20261104.md` (already reconstructed in this deliverable set) and *only then* run more expensive verification.
4. **Do not spam “continue”.** Each continuation is a fresh model call that counts against the bucket; wait out the reset before resuming.

## 3. Safeguard A — make the retry policy wait *past* the budget reset

The provider owns the retry policy (`retryPolicy` is configured **under each provider**, not the `llm-retry` plugin — the plugin rejects a `retryPolicy` config key, and `llm-pi-ai` resolves it per provider route). **Verified config location for this machine:** `C:\Users\abdelmaw\.dsh\profiles\web\cordis.patch.yml` → plugin `llm-pi-ai` → `config.providers.uni-paderborn`. **Before this fix no `retryPolicy` was set**, so `dsh-llm` applied defaults `{ normal, maxRetries: 500, initialDelayMs: 60_000, maxDelayMs: 60_000, jitterRatio: 0.1 }` (`packages/llm/llm/src/retry-policy.ts`) — the 60 s cap is what let the run spin against an ~budget-reset that it could never bridge.

> **Critical nuance — do not raise only `maxDelayMs`.** The default `initialDelayMs` is already 60 s, so exponential backoff starts at 60 s regardless of a higher cap. To span a full budget‑reset window you must **lower `initialDelayMs`** (e.g. 2000 ms) so backoff climbs from ~2 s up to a large `maxDelayMs`. `maxDelayMs` may be set up to `MAX_TIMER_DELAY_MS` ≈ 24.8 days.
>
> **Also: this gateway sends no `Retry-After` header** (only text “Limit resets at: …”), so `dsh-llm-retry` uses local exponential backoff only. Widening the local backoff (`initialDelayMs`, `maxDelayMs`, `maxRetries`) is therefore the only lever — not server‑provided wait times.

Applied configuration — 2026‑11‑05, **revised second pass** (first pass `maxRetries: 10` / `maxDelayMs: 1 h` proved too short to bridge a hard stall, so it was raised to `30` / `600000` ms and mirrored onto the responses route):

```yaml
        retryPolicy:
          mode: normal
          maxRetries: 30
          retryableCodes:
            - EMPTY_RESPONSE
            - RATE_LIMIT
            - SERVER
            - TIMEOUT
            - TRANSPORT
          backoff:
            initialDelayMs: 2000
            maxDelayMs: 600000    # 10 min — spans long token-budget refills
            jitterRatio: 0.2
```

Applied to **both** provider routes: `uni-paderborn` (chat completions) and `uni-paderborn-responses` (Responses).

Why each field:
- `maxRetries: 30` — lets a single throttled step run ~30 exponential retries (≈ several minutes of backoff), which spans the observed refill gap; still bounded so a truly hard‑stalled model fails loudly instead of spinning forever.
- `initialDelayMs: 2000` + `maxDelayMs: 600000` — backoff grows from ~2 s to 10 min, so a throttled step sleeps through the reset instead of re‑calling every minute and giving up at ~1–2 min.
- `retryableCodes` keep `RATE_LIMIT` (and `SERVER`, `TIMEOUT`, `TRANSPORT`, `EMPTY_RESPONSE`).
- `jitterRatio: 0.2` — desynchronizes parallel workers so they don’t re‑throttle in lockstep.

Retry‑After behavior: `dsh-llm-retry` honors a positive `providerRetryAfterMs` only when `≤ maxDelayMs`; otherwise in `normal` mode it gives up that step. This gateway sends no `Retry-After`, so the local backoff above is what matters. `maxDelayMs = 600000` (10 min) means any future server `Retry-After` up to 10 min would be honored.

> Do **not** edit the `dsh-llm-retry` / `dsh-llm` / `dsh-llm-pi-ai` source — the per‑provider `retryPolicy` config seam is the intended fix. Restart/refresh the host so the new provider policy is re‑registered (provider registration is read at startup).

## 4. Safeguard B — fail the run to safety instead of stalling

Budget exhaustion currently ends with an ambiguous `turn/end`. Add a bound so a long run **reports its state explicitly** rather than silently stopping:

- **Enforce a retry cap you can live with.** The current applied policy uses `maxRetries: 30` with a 10‑min `maxDelayMs`, so a throttled step can bridge a multi‑minute refill but still stops cleanly (surfacing the 429) if the model stays hard‑stalled past ~10 min. Lower `maxRetries` further if a bounded stop is preferred over a long wait; raise `maxDelayMs` if a single turn routinely needs longer than 10 min of refill.
- **Track the rate‑limit state in the session log.** `llm/retry` events are already durable (recorded before each wait) and *not* pruned by step/turn boundaries in the projection (`step/start`/`turn/end` clear the state, and it resets per provider+policy). Use the logged `failure` / `retry` counts as the audit trail; a run that ends with a high `RATE_LIMIT` retry count is a budget stall, not a finished run.

## 5. Safeguard C — checkpoint deliverables before expensive steps

The single most useful guard for long runs: **write the answer artifact first, spend budget after.**

- In any long autonomous run, create/refresh the intended deliverable (here the session reference doc, living handoff, status files) **before** running broad verification or many more model steps.
- Use the project’s existing living‑handoff convention: update the current‑status doc after every substantive step, so a mid‑flight stop leaves a recoverable checkpoint, never only a half‑finished transcript.
- Keep `compaction/…` and pruning from deleting these durable checkpoints; they are referenced by path in the handoff.

## 6. Safeguard D — pacing / throttling of autonomous continuation

- If the same model keys several subagents/workers (Orchestration mode is present in this profile), any single token bucket is shared. Pace/limit concurrent workers (the orchestration pool has a bounded attempt budget) so retries from many children do not drain the bucket in one burst.
- For very large jobs, prefer **explicit, separated turns** over one unbounded autonomous continuation so budget is spent in affordable slices and each segment ends with a written checkpoint.

## 7. One‑page decision flow

```
Got 429 token-limit (RATE_LIMIT)?
 ├─ Retry-After present and ≤ maxDelayMs?
 │     → wait providerRetryAfterMs, retry (already supported)
 ├─ Retry-After present but > maxDelayMs?
 │     → normal mode currently gives up the step
 │       FIX: raise maxDelayMs (cap 24.8 d) to honor it; else accept the loud failure
 ├─ No Retry-After, but budget reset is far out?
 │     → lower initialDelayMs + raise maxDelayMs so backoff spans the reset
 │       (applied: 2000 → 600000 ms, maxRetries 30); if still over the window,
 │       OR stop and wait for the reset before resuming (Safeguard A)
 └─ Still stalling after cap?
       → the step fails loudly after ~30 retries / ~10 min (B),
         resume with a single "continue" after reset, and
         confirm the deliverable doc exists first (C).
```

## 8. What to change and where (summary table)

Status: **Safeguard A applied — 2026‑11‑05 second pass** to `C:\Users\abdelmaw\.dsh\profiles\web\cordis.patch.yml` on **both** routes (`uni-paderborn` and `uni-paderborn-responses`). The rest are run‑discipline practices.

| Change | Where | Status | Effect |
|---|---|---|---|
| `retryPolicy.backoff.initialDelayMs: 2000` + `maxDelayMs: 600000` | Provider config (`uni-paderborn` + `-responses`) | **APPLIED** | Backoff climbs ~2 s → 10 min and bridges long token‑budget refills; honors `Retry-After` ≤ 10 min |
| `maxRetries: 30` (default was 500) | Provider config (both routes) | **APPLIED** | ~30 retries per step; sleeps through the refill, fails loudly if still stalled |
| Keep `RATE_LIMIT` in `retryableCodes`, `jitterRatio: 0.2` | Provider config (both routes) | **APPLIED** | Retries throttled codes; desyncs parallel workers |
| Write deliverable/checkpoint before heavy steps | Run discipline / living handoff | practice | A stop still leaves a recoverable artifact |
| Pace autonomous continuation + worker fan‑out | Orchestration pool budget | practice | Don’t drain a shared token bucket in one burst |

---
*Companion files: the reconstructed reference for the stopped run is [`CHAT_SESSION_REFERENCE_20261104.md`](CHAT_SESSION_REFERENCE_20261104.md).*
