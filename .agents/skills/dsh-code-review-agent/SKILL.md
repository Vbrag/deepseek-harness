---
name: dsh-code-review-agent
description: Perform a read-only, defect-first review of an uncommitted change, base-branch diff, commit, or delegated review request, and return every actionable finding in severity order. Use when another agent asks you to review code without modifying it, or when you need the merge-base discipline for a base-branch comparison. Distinct from dsh-code-review, which reviews the whole deepseek-harness PR.
---

# Read-only, defect-first change review

This skill is for the **delegated / standalone review task**: inspect a requested target and return every finding the author would likely fix, without modifying files, creating commits, pushing branches, posting review comments, or delegating onward. It complements the repository's [dsh-code-review](../dsh-code-review/SKILL.md), which orients a reviewer to the whole deepseek-harness PR; use this one when the target is scoped to a single change or a sub-agent hands you a discrete review task.

Read the applicable `AGENTS.md` instructions before reviewing. For the deepseek-harness repo, also read [docs/architecture.md](../../../docs/architecture.md) and the [defensive patterns](../../../docs/defensive-patterns/README.md) pages that the changed paths touch, exactly as [dsh-code-review](../dsh-code-review/SKILL.md) prescribes. Apply the repo's [dsh-prose-standard](../dsh-prose-standard/SKILL.md) and [dsh-error-handling](../dsh-error-handling/SKILL.md) when a finding involves prose or failure handling.

## Review the change

1. Read the applicable `AGENTS.md` instructions.
2. Inspect the complete diff for the requested target and enough surrounding code to understand each changed path.
3. Identify concrete regressions introduced by the change. Continue through the whole diff after finding the first issue.
4. Check the relevant tests and call sites to confirm each finding is real and actionable.

## Base-branch review

For a base-branch review, compare the changes that would actually merge rather than diffing directly against the branch tip. Resolve the comparison ref to the branch's upstream when that upstream exists and is ahead of the local branch; otherwise use the local branch. Run `git merge-base HEAD <comparison-ref>`, then inspect `git diff <merge-base-sha>`. If the local branch cannot be resolved, try its configured upstream explicitly before reporting that the target is unavailable.

For the deepseek-harness repo, prefer the repo's own change-scope command when it applies: `pnpm --silent run change-scope --base <verified-base-ref> --head <verified-head-ref>`, re-establishing the base after a retarget or merge, as the [dsh-code-review](../dsh-code-review/SKILL.md) skill requires.

## When to flag

Flag an issue only when all of the following are true:

- It affects correctness, security, performance, or maintainability in a meaningful way.
- It is discrete and actionable.
- It was introduced by the reviewed change.
- The affected scenario or call path can be demonstrated from the code.
- The author would probably fix it if they knew about it.

Do not flag speculative concerns, pre-existing problems, intentional behavior changes, or style nits that do not obscure the code. Apply the repo's regression-prevention lens: for the deepseek-harness repo, load [dsh-ci-test-reliability](../dsh-ci-test-reliability/SKILL.md) when the change touches resource-owning, asynchronous, or concurrency-sensitive tests.

## Severity

Present findings first, ordered by severity. Use one entry per issue in this form:

`[P1] Imperative finding title — path/to/file.rs:line`

Follow the title with one short paragraph explaining the affected scenario and why the behavior is wrong. Keep the cited range as small as possible and make sure it overlaps the reviewed diff.

- `P0`: universal release blocker or critical failure.
- `P1`: urgent defect that should be fixed next.
- `P2`: ordinary defect that should be fixed.
- `P3`: low-impact issue that is still worth fixing.

If there are no qualifying findings, say "No findings." Do not invent a finding to fill the result. After the findings, add a brief overall assessment and mention any material test gaps or residual risks.
