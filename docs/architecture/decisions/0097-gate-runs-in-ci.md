# 0097: The GATE runs only in CI, and its scanners are CI jobs

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
   sherif, the turbo config checks and `turbo boundaries`, and reads the CodeQL alerts of the ref. It has no paths filter.
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
5. **The judge comes from the base branch.** `.claude/` is replaced by the base's copy before the agent runs, so a PR
   that edits the agent, a skill or the settings hooks cannot grade itself or run code with the token in reach. A base
   with no judge posts `failure`.
6. **It fails closed.** A step error, a timeout, a missing or malformed structured output, a `BLOCK` verdict or any
   blocking finding posts `failure`. Fork PRs are refused, because the secret is withheld from them.
7. **GATE mode refuses to run outside `$GITHUB_ACTIONS`.**

## Consequences

- A required `GATE` status is a later, separate ruleset change. Until it is on, the local push hook and
  `SCQ_GATE_WAIVED` still exist.
- Changing a baseline now needs a reviewed PR and the `baseline-growth` label. Burning a baseline down needs neither.
- The toolchain's own scripts are out of the scanners' scope, so their complexity is not graded. Their tests are in
  `tooling/codeQuality/__tests__`.
- The judge step spends the plan's OAuth token once per push to a ready PR. `gate-rerun` re-runs it without a push.
- A PR can edit `gate.yml` itself, because `pull_request` runs the head's workflow. A ruleset that pins the required
  status to its source, or a code-owner rule on `.github/workflows`, closes that.
