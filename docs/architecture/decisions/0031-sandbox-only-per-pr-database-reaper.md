# 0031 — The per-PR database reaper is a sandbox-only capability that counts before it reclaims

Date: 2026-09-04
Status: accepted
Owner ruling: 2026-09-04 — "build the reaper, deployed at sandbox stages ONLY, never prod."

## Context

ADR-0006 gives every preview its own **logical** database on the one shared RDS instance. Exactly two exist:
`kitchensink_food_pr_{N}` (`foodDatabaseNameForStage`) and `kitchensink_recipes_pr_{N}`
(`recipeDatabaseNameForStage`). Identity has none.

ADR-0005's teardown is supposed to drop them when the PR closes. Its §1 originally hardcoded food's
migration-runner output, so every reaped RECIPE preview left its database behind. That defect is fixed — §1
now discovers drop doors by SHAPE, any `^[A-Za-z]+MigrationFunctionName$` output on the PR's own stacks — and
`perPrDatabaseDropDoors.test.ts` keeps the convention honest.

**The fix is still incomplete, and it is incomplete in the direction that cannot be seen.** A migration
runner lives INSIDE the stack whose database it drops, so shape-based discovery covers the normal path and
only the normal path:

- a stack **already deleted**, or resting in `DELETE_FAILED` / `UPDATE_ROLLBACK_FAILED`, publishes no outputs
  — so its database has no door at all. ADR-0007 × ADR-0022 wedged `kitchensink-recipe-service-pr-91` in
  exactly that state, and `RecipeWorkersStack`'s in-deploy trigger had already created the database;
- the databases **already stranded** by the period when `RecipeMigrationFunctionName` existed and nothing
  ever called it are unreachable by construction — their stacks are long gone.

A leaked logical database emits no signal: no alarm, no failing check, no CloudFormation resource, and a cost
too small to appear in a monthly total. It is the same invisible-leak shape as the `DELETE_FAILED` stacks and
the dangling preview CNAMEs.

### ⚠️ Nobody can currently COUNT them, and the census that was supposed to is asleep

Phase 0 built `packages/infra/global/src/db-bootstrap/perPrInventory.ts` and hung it off
`assertBootstrapPostconditions`, on the reasoning that the two bootstrap handlers already connect as master,
sit in the VPC, read `pg_database`, and "run on every `DataStack` deploy". **That last clause is false.** They
are CloudFormation **custom resources**, and CloudFormation re-invokes a custom resource only when its
PROPERTIES change. A sandbox global deploy completed on 2026-09-04 and both bootstrap Lambdas have **no log
streams at all** — the census has never run, and an ordinary deploy will not make it run.

So the number of stranded databases is unknown, and `docs/runbooks/pg18-upgrade.md` §A4 asks an operator for
precisely that number before a major upgrade, because a dump-and-restore window scales with the NUMBER of
databases and objects rather than with bytes.

## Decision

**A `PerPrDatabaseReaperFunction` in `DataStack`, deployed at NON-PROD stages only, that COUNTS by default
and reclaims by exact scope.**

### 1. It lives beside the instance, not beside a service

`DataStack` owns it, so it outlives every service stack and needs none of them to exist. It is VPC-attached
(the RDS is `PRIVATE_ISOLATED`), master-connected through the same credentials secret the two bootstrap
handlers read, and it discovers its own targets from `pg_database`. It takes a `pr-{N}` token and nothing
else.

### 2. Counting is the DEFAULT, and it drops nothing

`{}`, `{"action":"count"}` and an absent payload all produce a whole-instance census: the total, every
database grouped under the PR token that owns it, the subset PostgreSQL is already dropping
(`datconnlimit = -2`, which the pg18 runbook halts on and which must not be reported as an ordinary leak),
and the suffixed databases under a per-PR base that belong to no PR at all (`kitchensink_recipes_dev` and the
like) — reported rather than hidden, because silence would make the census read as "everything here is
accounted for".

⛔ The default matters as a **safety property**, not a convenience. An empty payload is what a mis-wired
caller, a retry that lost its body, or a hand-typed `aws lambda invoke` produces. A default of `drop` is one
keystroke from reaping whatever token happened to be in scope. An unknown `action` is a REFUSAL rather than a
fallback to the default: a caller that asked for something unimplemented got no answer, and silently counting
instead would report success for a teardown that reclaimed nothing.

### 3. ⛔ The scope predicate is the security boundary, and it is two independent checks

`packages/infra/global/src/db-reaper/perPrDatabaseScope.ts`, in the family of `.github/scripts/pr-scope.sh`,
`sandbox-wake.sh`'s `db_wake_is_sandbox_instance` and `sandboxSharedTier.ts`: one module of pure verdicts
with a suite that EXECUTES it and fires it at deliberately violating fakes.

A database is reapable for a token **iff all three** hold:

1. the token is exactly `pr-{digits}` — the same rule `pr_scope_is_token` demands;
2. the database is not one of the explicitly protected names; and
3. the name is **EXACTLY** one the repository's own derivation produces for that token.

⛔ **Exact equality, never a prefix and never `LIKE '%_pr_%'`.** `kitchensink_food_pr_15` must not answer a
request for `pr-1`, and here that is structural rather than something a trailing delimiter has to catch —
the same argument `pr_scope_environment_belongs` makes for GitHub Environments, and available because, unlike
an AWS stack, a logical database never carries a `pr-{N}-…` suffix. `pr_scope_belongs`'s PREFIX rule is the
weaker form and is deliberately NOT reused.

⛔ **Checks 2 and 3 are independent and neither is sufficient alone.** Check 2 is a DENYLIST of exact names —
`kitchensink_identity`, `kitchensink_food`, `kitchensink_recipes`, plus `postgres`/`template0`/`template1`/
`rdsadmin` — a statement about the DATABASE that survives any change to the derivation. It names
`kitchensink_identity` even though no derivation could ever produce it, precisely because the refusal must
not depend on the derivation being right. Check 3 is an ALLOWLIST of exact derived names, a statement about
the TOKEN × DATABASE pair. A single check is one edit away from authorising destruction; two
differently-shaped ones are not.

⛔ **The verdict is RE-ASSERTED at the point of destruction.** `executeReap` re-runs it on every planned name
before the first statement is issued, and refuses the whole plan if any name fails — the same belt-and-braces
`teardown-sandbox-pr.sh` applies before deleting a GitHub Environment ("the scope predicate let it through,
which is a bug in pr-scope.sh"). Reaching that throw means the predicate itself regressed.

The census direction (`perPrTokenOfDatabase`, "whose is this?") is a separate implementation, and the two are
asserted to AGREE over every token × database combination the suite can construct, so a widening of one
cannot quietly outrun the other.

### 4. ⛔ SANDBOX ONLY, twice over

`DataStack` creates the function only when the stage is not `prod`, **and** the handler refuses at RUNTIME
when `STAGE` is `prod`. The runtime refusal covers BOTH actions rather than just `drop`: leaving a prod census
reachable would make the drop guard the only thing standing, and "just let it count in prod" is exactly how
that erodes.

Prod has no per-PR logical databases at all — ADR-0006 grants its `food_app`/`recipe_app` roles no `CREATEDB`,
and `assertBootstrapPostconditions` asserts that — so in production the capability is **dead code carrying a
live risk**, and confining it removes the "master-credentialed `DROP DATABASE` in production" security
decision entirely rather than mitigating it.

### 5. Teardown §1 is repointed at it

`.github/scripts/teardown-sandbox-pr.sh` §1 now looks up `PerPrDatabaseReaperFunctionName` on
`kitchensink-data-sandbox` and invokes it once with `{"action":"drop","pr":"pr-{N}"}`. Every existing
diagnostic is preserved: the `FunctionError` grep (`aws lambda invoke` exits 0 when the function threw), the
AWS-CLI-v1 `--cli-binary-format` detection that cost a real diagnosis on 2026-08-27, and the owner's
2026-09-03 ruling that a failed drop is an `::error::` + `teardown_failed=1` which never ABORTS the run. An
ABSENT reaper output is an error on the same terms — a silent skip there is the green-check-over-a-leak shape
this path has been rebuilt twice to remove.

That **dissolves the ordering constraint** against §2: the reaper is not torn down with the PR, so the drop no
longer has to precede the stack deletes. It stays ahead of them anyway, on a different argument — §2 waits on
each delete and a wedged stack can consume the whole run.

The per-service `action: 'drop'` doors still exist and are still tested in their own packages; teardown simply
no longer depends on them. **One** authority for "how a per-PR database is dropped" is the point.

## ⛔ Accepted cost: a prod/sandbox template divergence, which ADR-0028 argues against

ADR-0028 §"Consequences of C" states the rule this decision breaks, in its own words: _"Keeping prod on a
different shape is how ADR-0007's cost problem came to hide in the exempted half."_ That is a real argument
and it is not being waved away — it is being **overridden on a specific counter-argument**, and the cost is
recorded here so nobody has to reconstruct it:

- **The counter-argument.** ADR-0028's rule is about a construct prod OUGHT to have and was excused from. This
  one prod cannot use: there are no per-PR databases at the prod stage, so a reaper there could only ever
  refuse. Making the shapes match would mean deploying a master-credentialed `DROP DATABASE` capability into
  production for the sole purpose of template symmetry — trading a live security surface for a diff.
- **What the divergence actually costs.** One Lambda, one execution role and one VPC attachment exist at
  sandbox and not at prod. Measured, not assumed: forcing the construct into prod and re-running the cdk-nag
  census moves **`IAM4` 33 → 35** (the two AWS-managed policies CDK attaches to a VPC Lambda's role:
  `AWSLambdaBasicExecutionRole` and `AWSLambdaVPCAccessExecutionRole`). Nothing else moves — `IAM5` is
  unchanged, because the only grant is a resource-scoped `secretsmanager:GetSecretValue`.
- **The real price is not the diff, it is the BLINDNESS.** `nagRulesAtZero.integration.test.ts` synthesizes
  every CDK app under `STAGE=prod`, so **no sandbox-only construct is ever seen by the cdk-nag census.** The
  reaper joins `SandboxSchedulerStack` in that hole; it is pre-existing and this decision widens it by one
  function. ADR-0013's table is therefore UNCHANGED by this work — measured, 14/14 green — and that "no
  change" is a fact about the census's stage, not evidence that the construct is clean. See Residual risk.
- **What is asserted instead.** `perPrDatabaseReaperStack.test.ts` pins the divergence in BOTH directions:
  prod synthesizes no reaper (no function, no output, no mention), and every non-prod stage synthesizes
  exactly one. A guard that only checked prod would pass a change that removed the reaper everywhere.

## Why the count-first capability exists at all

Because the Phase 0 census **cannot fire on an ordinary deploy** — see Context. `{"action":"count"}` is
invocable on demand, needs no properties to change, drops nothing, and answers the number the pg18 runbook
asks for. Every reap reports the same census alongside what it dropped, so a teardown that reclaimed nothing
still says what is out there.

`perPrInventory.ts` is retained rather than deleted: its `perPrLikePattern` — which escapes `_`, the
single-character `LIKE` wildcard that makes the obvious `` `${base}_%` `` match names it has no business
claiming — is reused by the reaper's catalogue read, so that trap is solved in one place.

## Consequences

**Positive**

- A per-PR database is reclaimable with no stack, no door and no deploy — including the ones already
  stranded.
- The stranded population becomes countable, on demand, for the first time.
- Teardown has ONE authority for dropping a per-PR database, and it is the one that cannot be orphaned.
- ADR-0004's consumer table gains `PerPrDatabaseReaperFunction`; no interface endpoint is needed (the only
  AWS API it calls is Secrets Manager, on the NAT like its two `DataStack` siblings).

**Negative / costs**

- The prod/sandbox template divergence above.
- One more VPC-attached Lambda on the shared `t4g.nano` NAT. Cost impact nil — a NAT instance bills by the
  hour, not per consumer — and it is invoked a handful of times a month.
- ADR-0004's consumer table is now stage-agnostic while one of its entries is not, so on prod the table
  overstates the live set by one. `natEgressConsumers.test.ts` discovers from the AST rather than a
  synthesized template, and a per-stage table would put the reader one step further from the source.
- `RecipeWorkersStack`'s `RecipeWorkersMigrationFunctionName` output is now referenced by nothing outside its
  own stack test. It was added for the partial-deploy leak this decision closes more completely; it is left
  in place rather than removed in the same change.

## Residual risk

- ⚠️ **NOTHING HAS BEEN DEPLOYED.** No `cdk deploy` has run, the reaper has never been invoked against the
  real account, and the stranded count is still unknown. The first count is the first real test — which is
  exactly how the log-group edge in ADR-0028 was found, so this note is not a formality.
- ⚠️ **A sandbox-only construct is invisible to the cdk-nag census** (above). Closing that means synthesizing
  the platform app at a second stage in `nagRulesAtZero.integration.test.ts`, which is a change to that
  suite's contract — ADR-0013's table is a per-rule census, and a two-stage census would need to decide
  whether a finding present in both stages counts once or twice. Deliberately not attempted here.
- ⚠️ **The reaper takes no lock.** Two concurrent invocations for the same token both issue
  `DROP DATABASE IF EXISTS … WITH (FORCE)`; the second is a no-op, so the outcome is right, but the second
  invocation's `dropped` list can name a database the first removed. Same class as ADR-0022's note that the
  migration runner takes no advisory lock.
- ⚠️ **`WITH (FORCE)` terminates sessions.** That is the point — a torn-down preview leaves them behind, and
  without FORCE PostgreSQL answers `55006 object_in_use` and the database survives every future sweep — but
  it means a reap of a LIVE preview would kill its connections. The scope predicate confines that to the
  named PR's own databases, and nothing else on the instance is reachable.
- ⚠️ **`kitchensink-data-sandbox` is named in the teardown script**, not derived. There is exactly one
  possible value (a preview never has a platform of its own; prod has no per-PR databases), but it is a
  literal, and a rename of the platform stack would surface as the "publishes no
  PerPrDatabaseReaperFunctionName" error rather than as a compile failure.

## Implementation guards

- `packages/infra/global/__tests__/perPrDatabaseScope.test.ts` — the predicate, fired at violating fakes:
  neighbouring PR numbers in both directions, every protected name, near-miss names, non-PR per-stage
  databases, case variants, and every malformed token. Asserts the drop verdict and the census direction
  agree, and that the denylist still refuses when the derivation is deliberately widened.
- `packages/infra/global/__tests__/perPrDatabaseReaper.test.ts` — the count default, the refusals, that
  counting issues no statement at all, and that a poisoned plan is refused before the first drop.
- `packages/infra/global/tests/perPrDatabaseReaper.integration.test.ts` — real PostgreSQL: the drop actually
  removes the database, `WITH (FORCE)` defeats a live session, the base and the neighbouring PR survive, the
  `LIKE … ESCAPE` narrowing claims nothing extra, and a second reap is idempotent.
- `packages/infra/global/__tests__/perPrDatabaseReaperStack.test.ts` — the sandbox-only divergence, both
  directions.
- `packages/infra/global/__tests__/perPrDatabaseDropDoors.test.ts` — the reaper's base register EQUALS the
  `*DatabaseNameForStage` producers discovered in the infra tree, both directions, so a third service's
  per-PR database cannot be silently unreapable.
- `packages/infra/global/tests/teardownPerPrDatabases.integration.test.ts` — the script's control flow,
  including a PR whose stacks are all gone.
- `packages/infra/global/__tests__/natEgressConsumers.test.ts` — ADR-0004's table, by equality.
