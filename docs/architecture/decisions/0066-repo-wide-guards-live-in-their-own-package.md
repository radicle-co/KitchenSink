# 0066 — Repo-wide guards live in their own package, and only tests that reach infrastructure code live in infra

- **Status:** Accepted
- **Date:** 2026-10-17
- **Relates to:** [ADR-0047](0047-shared-cors-policy.md) — its CORS guard is one of the guards that moved, and its decision 8
  names the new home. [ADR-0004](0004-minimize-nat-egress.md) and [ADR-0039](0039-database-role-split.md) — their guards are
  split between the two packages by the rule below.

## Context

The owner asked why `oneHookPerFile.test.ts` lived under `packages/infra/global/__tests__/`, since it is not
infrastructure. Most of the tests there were like it: they checked code standards, docs, CI workflows, CI scripts and
turbo wiring, and only a minority tested infrastructure code. The counts are in the commit that moved them.

They collected there for one reason. `packages/infra/global` was the one package whose test task turbo never caches and
whose tests may read the whole repository, so each new repo-wide guard was added to it, whatever its subject. Nothing
checked placement.

The cost was real, not only a naming problem:

- The guards ran only in the infra install. `packages/infra/global` is not an npm workspace, so its tests run in the
  `deployInfra.yml` global job, after an AWS sign-in, and outside the unit-test matrix and its coverage check.
- A reader looking for a guard about React hooks or ADR hygiene had no reason to look in infra.

## Decision

1. **A new workspace package, `packages/tools/repoGuards` (`@kitchensink/repo-guards`), holds what left infra.** That is
   the repo-wide guards (coding standards, docs, CI workflows and `.github/scripts`, turbo and test-tier wiring), plus the
   few suites that were in infra for no infra reason, such as the three LOCAL e2e suites over `@kitchensink/db-schema-guard`.
   It declares every dependency it imports.
2. **A test lives in `packages/infra/global` only when it reaches infrastructure code**: the CDK packages, infra-global's
   `lib/`, `src/` or `bin/`, or another package's `infra/` code. It reaches that code when it imports it (transitively,
   through local helpers), names an existing file in it by a relative path, or runs it in a child process listed with its
   reason. The DEPLOYED tier (`tests/deployed/`) verifies the deployed infrastructure and stays by its tier.

    ⚠️ The rule is reach, not topic. A guard ABOUT infrastructure that reads its source only as text, such as
    `natEgressConsumers` or `alarmSubscriptionWiring`, belongs in `repoGuards`. Do not move it back to infra for its topic.

3. **The rule is a guard.** `packages/tools/repoGuards/__tests__/guardPlacement.test.ts` fails when a file in `repoGuards`
   reaches infrastructure through its imports, and when a test in `packages/infra/global` does not reach it. It reads the
   TypeScript AST, so fixture text that names `aws-cdk-lib` does not count.
4. **Helpers that both sides use stay test helpers.** They live in `repoGuards/__tests__/` (and `tests/common/`) and are
   published one module per subpath export, with no barrel. Infra imports them by package name. Keeping them out of `src/`
   keeps them out of the scanners that read production source, exactly as before the move. A helper only infra uses stays in
   infra, with its unit test, and the guard holds that too.
5. **CI runs the guards; no deploy waits on them.** They run in their own unit-test group, with full git history, and in
   the infra integration job. `prod-deploy.yml` never ran them, because it calls `cdk deploy` directly. The sandbox preview
   deploys ran them inside the global job's test step, and no longer do. A merge still requires them, through CI.

## Consequences

- turbo can now see the guards, so `@kitchensink/repo-guards#test` and `#test:integration` replace the dead
  `@kitchensink/infra-global#test` entry, uncached for the same reason as before.
- Root lint and typecheck now cover the moved files through the workspace.
- ⚠️ The runtime-reach register in `guardPlacement.test.ts` is hand-kept. It is held exact: an entry that no longer exists,
  or that already reaches infrastructure through its imports, fails the guard.
- ⚠️ The check on `repoGuards` has no child-process side. A guard there that ran `tsx` on an infra entry point would pass
  it. None does.
