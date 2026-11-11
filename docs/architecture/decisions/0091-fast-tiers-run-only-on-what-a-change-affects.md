# 0091: The fast tiers run only on what a change affects

- **Status**: Accepted
- **Date**: 2026-11-11
- **Drivers**: The owner's request of 2026-11-11: "update all tests, linting, and formatting to only run on changed
  files."
- **Relates to**:
  [ADR-0086](0086-local-end-to-end-runs-select-by-impact.md) and
  [ADR-0087](0087-ci-end-to-end-runs-select-by-impact.md) do this for the end-to-end tiers. This record does it for
  the fast tiers, with the same rule and in the same package.

## Context

The fast tiers are unit and integration tests, lint (ESLint and actionlint), typecheck, and the Prettier checks. Before
this record, every pull request ran all of them on every package. The turbo cache already skipped a package whose
inputs had not changed since a cached pass. Some checks had no such cache:

- the integration steps
- the always-run guard tasks
- the docs Prettier check, which takes 31 s locally over every Markdown file
- actionlint and the Python checks.

A skipped check looks the same as a passed one. So the rule from ADR-0086 holds here too. If the selector cannot say
what a file affects, it runs the whole tier.

`turbo --affected` was measured first, and it cannot be the selector on its own:

- It returns no package for a change to the root `package.json`, a workflow, `pyproject.toml`, `.lintstagedrc.js` or a
  file under `docs/`. A root script or a hoisted dev dependency affects every package, and a test can read a docs file.
- It ignores task `inputs`. `@commise/features-recipes#test` reads a food-service seed and a docs mockup through
  `$TURBO_ROOT$` inputs, and a change there selected nothing.
- It measures its own change set, separate from the one `@kitchensink/e2e-plan` measures. Two change sets for one
  question can disagree.

## Decision

### 1. One selector, in `@kitchensink/e2e-plan`

`src/checkScope.ts` is the pure policy. Its input is the changed files and turbo's facts about one task. Its answer is
"every package" with a reason per file, or a list of seed packages with the reason for each:

- A file inside a workspace seeds that workspace. A folder nested inside a workspace that is not one itself (a service's
  `infra/`) belongs to the workspace around it, because no other workspace can import it.
- A file that a task declares as a `$TURBO_ROOT$` input seeds that task's package.
- A task with `cache: false` always runs. turbo.json marks a task that way because its real inputs cannot be hashed, so
  no change set can prove it unaffected.
- Markdown outside every package selects nothing.
- Anything else outside every package widens to the whole tier: a root config, the lockfile, a workflow, a script, a
  docs asset. So does any `turbo.json` and any change to the selector itself.

`src/checkScopeGraph.ts` asks turbo for the rest. A package a file is in brings everything that depends on it, through
turbo's own `...pkg` filter. A seed that only its own task needs (a declared input, an always-run task) brings nothing
else. `format` and `format:check` read one package's files only, so their seeds bring no dependents. The selector then
intersects with the caller's group, because turbo unions repeated `--filter` flags, and it emits package names only.

turbo.json is therefore the one contract for both caching and selection. A test that reads a file outside its package
declares it there, or both a cache hit and a skip will lie about it.

The per-file tiers live in `src/checkScopeFiles.ts`: Prettier over the Markdown no package owns, and actionlint over
the workflows. Each tier checks only its changed files. If its config changes, it checks every file. If none of
its files changed, it checks nothing.

### 2. One door: `npm run scope`

`bin/checkScope.ts` runs a tier (`run <task>`), lists a tier's packages (`list <task>`) or runs a per-file tool
(`files <tier> <command>`). It says why it chose what it chose. If it runs nothing, it prints a `::notice::`.

It takes the first of these that is set:

1. `FULL_SUITE=1`, or a reason in `CHECK_SCOPE_FULL`. Then everything runs.
2. The JSON list of paths in `CHECK_SCOPE_FILES`.
3. The files changed since the merge base with `--base`, `CHECK_SCOPE_BASE` or `origin/main`, with the working tree.
   It reads them through `gitChangeSet`, which the end-to-end selector uses too.

If it cannot read the change, it warns and runs everything.

The root scripts a developer types go through it: `test`, `lint`, `typecheck`, `format`, `format:check`, `format:docs`
and `format:check:docs`. The pre-commit hook typechecks what the staged and edited files affect (`--base=HEAD`). It
used to typecheck the whole repository. lint-staged still formats and oxlints only the staged files.

### 3. CI decides once, in `select-checks`

`select-checks` needs no other job and no `node_modules`. It runs `.github/scripts/selectChecks.sh` with git and jq
only, so it is ready before the install finishes. It publishes three outputs:

- `full`: empty, or the reason everything runs.
- `files`: the changed files since the merge base with the pull request's base branch, as a JSON list.
- `python`: whether the Python checks run.

`full` is set for every event that is not a pull request. **So a push to main always runs every check.** Main is
always fully verified. `full` is also set for a change of more than 3,000 files. A job output cannot carry that list
safely.

The lint, format, typecheck, unit test and integration jobs read `full` and `files` into `CHECK_SCOPE_FULL` and
`CHECK_SCOPE_FILES`. Each runs its tier through `npm run -s scope`. Each integration job lists its packages once
(`list test:integration`). If the list holds a step's package, that step runs. The step's `if:` names the same package
that the step runs.

These changes make the Python job run ruff and mypy: a Python file, a Python tool config, or a path outside every
package. If none of them changed, it prints a notice. mypy checks a whole project, so it does not run per file. The whole Python
tier takes seconds. Skipping it saves the toolchain install.

Jobs are never skipped. Each job runs and its steps say why they did nothing. The CI verdict therefore still turns any
skipped job red except the sandbox jobs (owner rule, 2026-10-03).

### 4. What stays whole

- **The infra jobs and `integration-infra`'s CDK and Python packaging steps.** They synthesize stacks from packages
  across the graph and from folders outside every workspace, so they keep running on every pull request.
- **`contract-drift`.** It regenerates every contract and diffs the tree. It is a generator gate, not a test tier.
- **Local Python scripts.** `npm run lint:python`, `format:check:python` and `typecheck:python` stay whole. They take
  seconds.

### 5. Guarded

- `e2ePlan`'s `checkScope`, `checkScopeFiles`, `checkScope.integration` and `checkScopeBin.integration` suites prove
  the selection over fixtures and over turbo's real graph:
    - A leaf change selects its dependents and nothing unrelated.
    - A shared package selects its consumers.
    - A root config change selects everything.
    - A group is an intersection.
    - A change the command line cannot read runs everything.
- `repoGuards`' `changedOnlyChecks.test.ts` runs the real `selectChecks.sh` (push events and unattributable paths widen)
  and reads `_ci.yml`:
    - No step runs `turbo run` on a fast tier bare.
    - Every fast-tier job reads the decision.
    - Every integration step is gated on its own package.
    - The root scripts go through the selector.

## Consequences

- A pull request that touches one leaf package runs that package, its dependents and the always-run tasks. A pull
  request that touches a root config, the lockfile or a workflow runs everything, as before.
- The local runs measure from the merge base with `origin/main`, not from ADR-0086's green stamp. The turbo cache
  already skips what last passed locally, so a stamp adds a second record of the same fact.
- A scoped run uses fewer turbo cache entries, so `pruneTurboCache.sh` saves a smaller cache. A later run that needs an
  entry this run did not use recomputes it. A push to main runs everything and saves a full cache.
- This pull request changes the selector, root scripts and workflows, so its own CI widens to everything. The first
  narrowed run is the next pull request that touches only packages.

## Residual risk

- **An undeclared import is invisible.** A package that imports a hoisted sibling it never declares has no edge in the
  graph, so a change to that sibling does not select it. The `no-extraneous-dependencies` rule covers only the
  packages that build an image. The push to main still runs everything and catches it after merge.
- **An undeclared outside read is invisible.** A test that reads a file outside its package without declaring it in
  turbo.json is wrong for caching today and is now also wrong for selection. The fix is the same: declare it.
- **A nested non-workspace folder is attributed to the workspace around it.** That is right while no other workspace
  imports from it, which npm workspaces cannot do without a relative import across a boundary, and the house rules ban
  those.
