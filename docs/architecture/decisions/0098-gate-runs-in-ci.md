# 0098: The GATE runs only in CI, and its scanners are CI jobs

- **Status:** Accepted
- **Date:** 2026-11-20
- **Relates to:** the `staff-code-quality` agent (CLAUDE.md, "Code health goes through `staff-code-quality`") and
  `docs/engineering/CodeQualityAgentDesignReferences.md`. It replaces the earlier decision, recorded in a comment in
  `_ci.yml`, to keep the `turbo boundaries` ratchet in the agent's user-level skill and out of CI.
- **Drivers:** owner ruling 2026-11-19, "add the scanners to CI and we can remove all of them from GATE. Then run the
  GATE only in the CI and not by any agent on the machine; the GATE should be required before merge." Owner answers
  2026-11-20: publish the agent, corpus and playbooks as they are, and use the plan OAuth token secret
  `CLAUDE_CODE_OAUTH_TOKEN`.

## Context

The GATE ran on a developer machine, as a user-level agent, and a push hook checked a stamp it wrote. Three things
were wrong with that. A machine without the skill, or a push under `SCQ_GATE_WAIVED`, was not checked at all. The scanners
and the boundaries baseline lived outside the repository, so nobody could review a change to either. And a GATE run
inside an agent session costs that session's budget and cannot be required by the repository.

## Decision

1. **The scanners are one CI job.** `Code quality scanners` (`codeQuality` in `_ci.yml`) runs type-aware ESLint with
   SonarJS and the React, a11y, Node, Promise, Security and Next layers, Semgrep, dependency-cruiser, jscpd, knip,
   sherif, the turbo config checks and `turbo boundaries`, and reads the CodeQL alerts of the ref. It has no paths filter,
   and it looks only at files the PR changes (point 8).
   The repository's own lint, zizmor, ruff and mypy are not repeated, because other jobs already run them.
2. **The toolchain lives in `tooling/codeQuality`, outside the npm workspaces.** Its exact pins and lockfile never touch
   the root install. The scripts are the published ones, with their paths made repository-relative.
3. **A pure Policy decides the job's result** (`scanVerdict.mjs`). The job fails on: an error-severity finding on a
   changed line; a tool that FAILED or was missing; a tool with no targets or skipped although the diff holds files of
   its kind; a boundaries triple new to the repository; and growth of any baseline file unless the PR carries the label
   `baseline-growth`. CodeQL alone may be absent, because its own workflow publishes its analysis.
4. **The GATE is a separate workflow** (`gate.yml`) that posts the commit status `GATE`. A draft PR gets `pending`. A
   ready PR waits for the scanner job on the same commit, downloads its `scq-<sha>` artifact and runs the
   `staff-code-quality` agent in GATE mode, which reads that evidence and runs no scanner.
5. **The judge comes from the base branch.** `.claude/` and the standards the card cites (`docs/CODING_STANDARDS.md`,
   `docs/engineering/`, `docs/architecture/`, `docs/adr/` and `adr/`) are replaced by the base's copy before the agent
   runs, so a PR that edits the agent, a skill, the settings hooks or a rule cannot grade itself or run code with the
   token in reach. The brief also lists the merge-base copy of each plan or tasks file the PR changes, so the judge can
   tell a wrap-up task from base from one the PR adds. A base
   with no judge posts `failure`.
6. **It fails closed.** A step error, a timeout, a missing or malformed structured output, a `BLOCK` verdict or any
   blocking finding posts `failure`. Fork PRs are refused, because the secret is withheld from them. One shape gets a
   single retry (owner ruling 2026-11-21): the judge finished with a success result
   but gave no structured output, because it ended in prose (the step fails, or it ends as success with an empty output). The prompt now says the final action must be the structured
   output. The `retry` step reads the action's execution file and allows one more judge run for exactly that shape, and never when the judge gave any output.
   Every other failure stays `failure` with no retry. `gateJudgeRetry.test.ts` pins this.
7. **GATE mode refuses to run outside `$GITHUB_ACTIONS`.**
8. **Only changed files (owner ruling 2026-11-20, "We should only run on files that change").**
    - A scanner runs only when the PR changes a file of its kind, and is pointed at the changed files: ESLint at the
      changed files of each package, dependency-cruiser at the changed files, Semgrep, ruff and mypy at the changed
      code and `.py` files. knip runs only when a changed file adds or removes an export or an import, or a manifest
      changes. jscpd still compares the changed files against the repository, but reports only a clone that touches a
      changed line. sherif and the turbo checks run only for a manifest or code change. Findings keep the
      changed-line filter. `scanScope.mjs` holds these rules.
    - A tool with nothing of its kind reports `NOT_APPLICABLE`, which passes. `scanVerdict.mjs` re-checks that claim
      against the counts of changed files, so a tool that reports it while the PR holds its kind fails. A tool missing
      from the status ("never ran") still fails. A docs-only PR therefore passes the scanner job with every tool
      `NOT_APPLICABLE`.
    - The judge gets the list of changed files and the diff of those files once (`judgeBrief.md`, `changes.diff`). It
      judges only them and their changed lines, may read other files only to understand them, and a finding on any
      other file is dropped (`gateScope.mjs`).
    - Every verdict is kept per file with the file's blob id, in the run artifact `gate-<sha>`. A rerun judges only the
      files whose (path, blob id) has no earlier verdict. An unchanged file keeps its verdict, so a BLOCK on it stays
      until the file changes. When every changed file already has a verdict, the status repeats it with "reused from
      <sha>" and the model is not called. The merged verdict is BLOCK if any changed file's latest verdict is BLOCK
      (`gateLedger.mjs`). A blocking finding that names no file blocks every file of that run.
    - A docs-only PR still gets a GATE result: one judge run over the changed doc set, asked to review the documents
      and not the repository.
    - `gateRun.mjs`, `gateLedger.mjs` and `gateScope.mjs` run in `gate.yml` from the BASE branch, without the token,
      for the same reason the judge does.

## Consequences

- A required `GATE` status is a later, separate ruleset change. Until it is on, the local push hook and
  `SCQ_GATE_WAIVED` still exist.
- Changing a baseline now needs a reviewed PR and the `baseline-growth` label. Burning a baseline down needs neither.
- The toolchain's own scripts are out of the scanners' scope, so their complexity is not graded. Their tests are in
  `tooling/codeQuality/__tests__`.
- The judge step spends the plan's OAuth token once per push to a ready PR that changes a file with no verdict yet.
  A push that changes nothing new costs no model call. `gate-rerun` re-runs it without a push.
- A verdict is per file content, not per PR state. A change to a file that an unchanged file depends on does not
  re-judge the unchanged file; that is the ruling's cost. A later change to the base is not seen either, until the
  file changes. Residual risk, accepted.
- The first PR that adds this tooling cannot run `gate.yml` against itself, because the tooling is read from the base.
- A PR can edit `gate.yml` itself, because `pull_request` runs the head's workflow. A ruleset that pins the required
  status to its source, or a code-owner rule on `.github/workflows`, closes that.

## Known gaps until the ruleset PR

The ruleset PR that follows this one closes these three. Until it merges, the `GATE` status is not a hard guarantee.

- **Ledger artifacts are accepted from any run of the branch.** `gate.yml` restores `gate-<sha>` from every completed
  run on the head ref. It must accept them only from runs of the pinned workflow on the base.
- **The required check is a status context, not a pinned workflow.** The ruleset must require the workflow itself, so
  that a PR cannot post a `GATE` status from another source.
- **Scanner evidence can be forged.** The judge reads the `scq-<sha>` artifact of the PR's own `ci-pr.yml` run, which
  the head's workflow produces. The evidence must come from the pinned workflow.
