---
name: eval-harness
description: Define and run eval-driven development — capability and regression evaluations with pass@k and pass^k metrics and code, model, or human graders. Load when planning a feature before implementation, verifying a change, or tracking regressions against a baseline.
---

# Eval-driven development

Use this skill when you want to apply evaluation-driven development (EDD): define expected behavior before implementation, run evaluations continuously as you build, and track regressions with each change. It is the "unit tests of AI development" — a formal way to decide what done means and to catch regressions.

## When to activate

- Before implementing a feature: define success criteria first.
- During implementation: run capability evals to confirm the change does what was intended.
- Before a pull request or release: run regression evals against a baseline.
- After a refactor: confirm existing behavior is unchanged.

## Eval types

### Capability evals

Test whether a change accomplishes something it could not before:

```markdown
[CAPABILITY EVAL: feature-name]
Task: <what the change should accomplish>
Success criteria:
  - [ ] Criterion 1
  - [ ] Criterion 2
Expected output: <what a correct result looks like>
```

### Regression evals

Ensure changes do not break existing behavior:

```markdown
[REGRESSION EVAL: feature-name]
Baseline: <SHA, checkpoint, or previous passing set>
Tests:
  - existing-test-1: PASS/FAIL
  - existing-test-2: PASS/FAIL
Result: X/Y passed (previously Y/Y)
```

## Grader types

- **Code-based grader (preferred)**: a deterministic check over the output or repository — for example a test command, a build, or a file-content assertion. Deterministic beats probabilistic.
- **Model-based grader**: for open-ended outputs, evaluate the result against the success criteria with a reasoned score and an explicit pass threshold.
- **Human grader**: flag sensitive or ambiguous changes (for example security) for explicit human review; never fully automate security checks.

Prefer a code-based grader whenever the outcome is mechanically checkable; reserve model or human grading for outputs code cannot judge.

## Metrics

- **pass@k** — at least one success in k attempts; pass@1 is the first-attempt success rate. A typical target for capability evals is pass@3 above a chosen threshold.
- **pass^k** — all k trials succeed; the higher reliability bar, appropriate for critical paths and regression evals, where it should be 100%.

## Workflow

1. **Define before coding.** Write the capability and regression evals and their success metrics first. This forces a clear, testable statement of what done means.
2. **Implement** to satisfy the defined evals.
3. **Evaluate.** Run each capability eval and the regression set, and record PASS/FAIL per item.
4. **Report.** Produce a short report with per-item results, the pass@k / pass^k metrics, and an overall status (for example `READY FOR REVIEW` or `SHIP IT`).

In a DeepSeek Harness codebase, wire the mechanical graders to the project's own gates — for example the typecheck, lint, unit-test, and keyless recorded-session snapshot commands in CI — rather than inventing ad hoc commands. Match the evidence to the surface being changed; do not reflexively run the entire suite for a small change.

## Eval storage

Keep evals as first-class, versioned artifacts beside the code so they move with the change, for example under a project-local `.evals/` directory with a definition file, a run-history log, and a baseline reference. Version evals with the code they protect.

## Best practices

1. Define evals before coding; clarity of success criteria is the point.
2. Run them frequently to catch regressions early.
3. Track pass@k over time to monitor reliability trends.
4. Use code graders whenever possible; deterministic > probabilistic.
5. Keep human review for security and other high-consequence surfaces.
6. Keep evals fast so they actually get run.
7. Version evals with the code and store the baseline you compare against.

## Cross-reference

When the change is in a DeepSeek Harness codebase, blend this skill with the repository's gate-selection guidance: choose the smallest set of checks that cover the actual diff, run keyless recorded-session snapshots for model- or user-visible changes, and let CI own the exhaustive matrix. This skill supplies the eval-driven framing and the pass@k / pass^k discipline, not the repository's specific gate commands.
