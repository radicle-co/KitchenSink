# 0010 — Every PR preview is a COMPLETE ecosystem: the ensure-exists deploy gate

- **Status**: Accepted
- **Date**: 2026-07-29
- **Drivers**: issue #124 ("the entire ecosystem needs to exist and be deployed and fully working all the way down")
- **Relates to**: [ADR-0003](0003-shared-alb-per-stage.md) (shared ALB + host rules), [ADR-0005](0005-environment-tagging-and-pr-cleanup.md) (per-PR teardown), [ADR-0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md) (per-PR feature deploys), [ADR-0007](0007-sandbox-cost-controls.md) / [ADR-0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md) (cost posture)

## Context — the failure

`sandbox-deploy.yml` had one deploy job per feature service, and each one gated **every step** on a
`dorny/paths-filter` result:

- `deploy-food` ran only when `packages/services/food-service/**` changed;
- `deploy-recipe` ran only when the recipe tier changed.

So a **recipe-only PR deployed no food service at all**. That became load-bearing in `c60dc9ae`, which made
`RECIPE_FOOD_SERVICE_URL` a **required** prop pointing at `https://food-pr-{N}.commise.app`. On a recipe-only
PR that host does not exist, so:

- the recipe service booted happily (the URL is only used per keystroke),
- `/health` answered `200`,
- `cdk deploy` reported success,
- the CORS + image-currency smoke checks passed,
- and the ingredient typeahead's catalog section silently reported `catalogAvailability: 'unavailable'` for
  the entire preview.

The blended USDA catalog — the whole point of the integration — was untestable on most previews, and **every
signal was green**. This is the same shape as the defect that motivated the deployed-smoke module: a healthy
service is not a working system.

## Decision

### 1. Gating semantics: **ensure-exists**, not paths-only and not always-redeploy

A service's deploy job runs when **any** of these holds:

| condition                                                    | why                                             |
| ------------------------------------------------------------ | ----------------------------------------------- |
| its sources CHANGED on the PR                                | the preview must contain the PR's own code      |
| the run was manually dispatched                              | `workflow_dispatch` has no PR diff to filter on |
| a per-PR stack is **ABSENT** or in an unusable resting state | the preview is incomplete without it            |
| the origin it should be serving does not answer `200`        | a converged stack is not a working service      |

and it **skips only when it is both unchanged and already serving**. The decision, and the reason for it, are
computed by `.github/scripts/deploy-gate.sh` — one definition shared by both jobs — and published as
`steps.gate.outputs.deploy`.

Statuses treated as "deployed and usable": `CREATE_COMPLETE`, `UPDATE_COMPLETE`, `UPDATE_ROLLBACK_COMPLETE`
(the last _update_ failed but the stack is intact at its previous working revision), `IMPORT_COMPLETE`.
Everything else — including a failed `describe-stacks`, which is translated to the value `ABSENT` — deploys.
The bias is deliberate: erring towards "deploy" costs one deploy, while erring towards "skip" ships an
incomplete preview behind a green check, which is the failure being removed.

**Consequence — a fresh docs-only PR gets a complete stack.** On its first `opened` event nothing exists, so
both jobs deploy food, recipe-workers and recipe-service; every later push skips both (unchanged and serving).
A preview that was reaped by the daily sweeper, wedged in `ROLLBACK_FAILED`, or lost its tasks **self-heals on
the next push** — behaviour neither of the alternatives below provides.

### 2. Rejected: "always redeploy everything on every PR"

The crude reading of #124. It satisfies the guarantee, but it rebuilds and pushes **two Docker images**, runs
two turbo builds and four `cdk deploy` passes for a README-only push — on _every_ `synchronize`, so the cost
is per-push, not per-PR. Ensure-exists gives the identical end state (all three stacks present and serving)
for **one** deploy per PR lifetime instead of one per push, so it was chosen.

### 3. Rejected: keeping the paths filters and documenting the degradation

That was the status quo (a `::warning::` in the recipe job saying the catalog would be unavailable). A warning
on a green run is not a guarantee; #124 exists because nobody reads it. That warning is now an **`::error::`**
— reaching the recipe deploy without a food stack for the stage means the ecosystem is genuinely incomplete.

### 4. Proving it: the smoke asserts the ECOSYSTEM, and **401 is the PASS**

`packages/services/recipe-service/infra/smoke/deployedSmoke.ts` gained two pure classifiers:

- `classifyDependencyWiring` — the **running** recipe task definition's `FOOD_SERVICE_URL` is _this stage's_
  food origin. Catches both the original defect (no `FOOD_*` variables at all) and cross-wiring to another
  stage's catalog, which looks like it works while testing someone else's data.
- `classifyDependencyReachability` — that food origin actually answers.

⛔ The trap: `food-pr-{N}.commise.app/api/v1/foods/search` returns **`401` by design** (it requires a
Clerk-verified token). "200 or bust" would fail every correctly-wired preview. So:

| observation        | verdict  | what it proves                                                                                         |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `401` / `403`      | **PASS** | DNS resolved, the shared-ALB host rule matched, and food's auth layer ran                              |
| `429`              | PASS     | only the service can shed load (the ALB has no such action), so the request arrived                    |
| no response        | FAIL     | the host does not exist — this stage has no food service                                               |
| `404` `text/plain` | FAIL     | the shared ALB's **default** fixed response: no listener rule for this host (ADR-0003)                 |
| `404` JSON         | FAIL     | routed, but the deployed food build predates the endpoint                                              |
| `2xx`              | FAIL     | it answered an **unauthenticated** catalog search: the auth boundary is open, or this host is not food |
| `5xx`              | FAIL     | routed, but food is failing                                                                            |

The smoke now runs on **every** event (not only when the recipe job deployed), with the image-currency flag
passed only when this run deployed — so a preview left half-wired is reported even by a push that deployed
nothing.

### 5. Ordering: `needs: deploy-food`, with two belts

Recipe requires food's origin, so `deploy-recipe` keeps `needs: deploy-food`. A **skipped** dependency skips
its dependents, so the ordering is protected twice:

1. `deploy-food`'s job-level `if:` stays true for every non-closed `pull_request` event (its gate skips the
   _work_, per step), so on a PR it always reaches a conclusion.
2. `deploy-recipe`'s `if:` is prefixed with `!cancelled() && needs.deploy-food.result != 'failure'`, which
   _also fixes_ `workflow_dispatch` with `service: recipe` — there `deploy-food` is genuinely skipped, and the
   previous unqualified `if:` skipped the recipe deploy along with it.

A food deploy that **fails** still blocks recipe, on purpose.

**ALB listener priorities are untouched.** The disjoint bands stay as they are (identity 100, food 200, recipe
300; per-PR food `10000 + N`, per-PR recipe `30000 + N`, named stages in a higher band) — this ADR changes
_when_ a stack is deployed, never _what_ it allocates.

## Cost

Per open PR, the delta is the food service that previously did not exist on a recipe-only PR: **1 API task +
1 worker task** on Fargate Spot, 24/7.

| item        | size               | Fargate Spot (us-east-1)     |
| ----------- | ------------------ | ---------------------------- |
| food API    | 0.5 vCPU / 1 GB    | ≈ $5.50 / mo                 |
| food worker | 0.25 vCPU / 0.5 GB | ≈ $2.75 / mo                 |
| **total**   |                    | **≈ $8.25 / mo per open PR** |

Two offsets are part of this decision:

- the per-PR API count is **1**, not the stack default of 2 (`FOOD_DESIRED_COUNT=1` in the sandbox workflow
  only) — a preview has no availability requirement, and the second task was ≈ $5.50/mo of pure carry. Prod
  deploys from `prod-deploy.yml` and keeps the two-task default;
- the per-PR **logical** database on the shared instance (ADR-0006) means no new RDS cost, and the shared ALB
  (ADR-0003) means no new load balancer.

CI-minute delta: `setup-node` + `npm ci` + credentials + the gate now run unconditionally in both jobs (~1–2
min per job per event) so the gate can query CloudFormation and derive the food host by **running**
`printFoodHost.ts` instead of re-typing `food-pr-{N}.<domain>` in YAML. That is far cheaper than what the
gate skips, and it avoids a second copy of a host shape that is a TLS constraint.

## Teardown (verified, not assumed)

`.github/scripts/teardown-sandbox-pr.sh` already reclaims a food stack for **any** PR that has one — nothing
in it is conditional on the PR having touched food:

- §1 drops the `kitchensink_food_pr_{N}` logical DB by looking up `kitchensink-food-service-pr-{N}`'s
  migration-function output, and prints "nothing to drop" when the stack is absent;
- §2 deletes stacks matching the `pr-{N}` name rule **or** the `Environment=pr-{N}` tag — and
  `food-service/infra/bin/app.ts` tags `Environment = stage` for any `pr-*` stage at the `App` level, so
  `kitchensink-food-service-pr-{N}` is caught by the tag;
- §3/§4 sweep the log groups and ECR repos the stacks do not own, by tag and by the delimiter-aware name rule.

The only thing that changes is how _often_ that path is exercised. The `pr-{N}` scope predicates
(`.github/scripts/pr-scope.sh`) are untouched.

## Residual risks (known, not fixed here)

1. **Per-PR ECS is NOT in the sandbox nightly-shutdown selector.** `isSandboxClusterArn` matches a cluster
   whose name contains `sandbox`; per-PR clusters are named `kitchensink-{service}-pr-{N}-…`, so every preview
   runs Fargate 24/7 even though the shared sandbox RDS is stopped 00:00–09:00 ET (ADR-0007). Widening the
   selector to `pr-{N}` clusters would cut ~37% off every preview's compute bill and cost nothing in
   functionality (the database is already down in that window). It needs its own PR: it changes the global
   infra package and requires a `packages/infra/global` deploy.
2. **An unchanged service can be stale relative to a rebased branch.** `paths-filter` reports the PR's _own_
   diff, so if `main` changes food and a recipe-only PR rebases onto it, food is "unchanged" for that PR and
   the gate keeps the image built at first deploy. The fix is a content-addressed image tag (hash the food
   source trees and compare it to the deployed tag), which subsumes ensure-exists; it was left out to keep
   this change reviewable. Scope of the exposure: bounded by how far `main`'s food code moves while a
   food-untouching PR is open.
3. **Fork PRs.** Both jobs now reach `configure-aws-credentials` on every PR event, so a fork PR (no secrets)
   fails these jobs where a docs-only fork PR previously skipped them.
4. **The smoke probes from the CI runner, not from the recipe task.** A runner-side 401 proves DNS, the ALB
   host rule and food's auth; it does not prove the ECS task's own egress path (public subnet → IGW → ALB).
   Closing that would need an unauthenticated recipe endpoint that reports its dependency's state, which does
   not exist today.

## Update (2026-09-02) — the gate closes the deploy GRAPH, and prod gets it first

This ADR's four conditions all ask one question: **should THIS leg run?** They cannot ask the other question a
per-leg gate owes — **is the leg this one DEPENDS ON running too** — and that gap was live in production.

### The failure

`prod-deploy.yml` gated every leg independently on a `dorny/paths-filter` group, so a change touching only
`packages/services/identity-webhooks/**` set `deploy_webhooks=true` and `deploy_global=false`. ADR-0028 had
moved the identity ECS log group into `ServiceLogsStack` — a child of the **global** app — recording that it
"already deploys before both consumers, so no deploy order changed". That is true of the **order** and false of
the **gate**: the earlier leg does not run at all.

Measured against the live account on 2026-09-02: **`kitchensink-service-logs-prod` does not exist.** ADR-0028
added it on 2026-08-30 and prod has had no platform deploy since, so the next webhooks-only merge would have
died inside `cdk deploy` on `No export named kitchensink-service-logs-prod:IdentityServiceLogGroupName found`.
`IdentityServiceStack` resolves the same export, so an identity-only merge had the identical hole — a second
consumer the report never named, and which only a derivation found.

`DependsOn` cannot leave a stack and nothing orders two `cdk deploy` invocations (ADR-0022 §5), so a
`Fn.importValue` crossing a CDK **app** boundary is the one edge only the pipeline can honour.

### Decision — a fifth condition, DERIVED

> A producer leg also deploys when a leg that IS deploying imports an export the account does not publish.

Three parts, each with one owner:

1. **The edges are read from the CDK source.** `scripts/infrastructureManifest.mjs` (schema 2) collects every
   `Fn.importValue` by AST, joins each to the app declaring the producing stack, and projects the cross-app
   ones to `docs/generated/infrastructure/cross-app-imports.tsv` under the manifest's existing
   regenerate-and-diff staleness gate. ⛔ **Never a hand-maintained table.** A copy of a list cannot detect
   that the list grew — the ALB priority collision, the stale NAT consumer list and ADR-0025's asset guard all
   cost this repository the same lesson. A `Fn.importValue` written tomorrow is covered tomorrow.
2. **Which edges are unmet is I/O.** `deploy-gate.sh unmet-imports` resolves each export through
   `.github/scripts/cfn-export.sh` — never an open-coded `list-exports --query`, which is wrong per page
   (ADR-0005).
3. **Forcing a leg is a pure decision.** `deploy-gate.sh close` takes the unmet edges and the current flags
   and returns the closed flags, in the same pure/impure split `decide`/`evaluate` already use.

### Three things that look arbitrary and are not

- **The rule is NARROW: only a DEPLOYING consumer forces its producer.** "Force the producer whenever any
  consumer leg runs" makes every prod deploy a full platform rollout — RDS, VPC and edge — for a webhooks
  typo. "Force it whenever anything is missing" does the same from an unrelated leg. This fires only where the
  deploy would otherwise FAIL, so it stops firing the moment the platform is whole.
- **An unknown CONSUMER is ignored; an unknown PRODUCER is refused.** `@commise/web`'s router imports from the
  platform and is shipped by Vercel, so erroring on it would red every prod deploy. A missing PRODUCER means a
  leg IS deploying and what it depends on is not something this workflow can force — a hole no gate can close,
  which somebody has to decide about. `crossAppImportClosure.test.ts` turns that into a commit-time failure.
- **`unmet-imports` calls `sts get-caller-identity` first.** `cfn-export.sh --optional` cannot tell "the export
  is absent" from "the CLI failed" — it answers empty for both. Without the precondition a credentials glitch
  would mark every cross-app export missing and force a full platform rollout to production as a side effect:
  the exact blast radius the narrow rule exists to avoid, arriving through the back door.

`Configure AWS credentials` moved above `Compute deploy flags` so the probe can run before the flags every
later `if:` reads. `sandbox-identity-deploy.yml` already had that order for the same reason.

### Residual risks

5. **Only `prod-deploy.yml` is closed.** `sandbox-identity-deploy.yml` still probes a **hand-written** two-stack
   list (`kitchensink-network-sandbox`, `kitchensink-alb-sandbox`) to decide `global_missing` — and it is
   already stale by exactly this defect: `kitchensink-service-logs-sandbox` is imported by two of its own legs
   and is not probed. Replacing that list with this closure is the obvious follow-up.
6. **`sandbox-deploy.yml` cannot be closed from inside itself.** Its per-PR food and recipe stacks import from
   the `sandbox` platform, which a DIFFERENT workflow deploys, so no flag it owns can force the producer. That
   is a cross-workflow ordering problem this mechanism does not address.
7. **The probe costs one paginated `list-exports` per distinct export** (~30 on prod, a few seconds each). It
   runs on every prod deploy. Reading the full export list once would be cheaper and would stand up a second
   export-resolution mechanism beside `cfn-export.sh`; DRY won.
8. **A placeholder that is neither `{stage}` nor `{baseStage}` is read as the deploy stage.** The manifest's
   placeholder is the CDK author's local variable name (`WebhooksStack` alone uses `deployStage` and
   `identityStage`), which a hermetic AST read cannot classify further. That reading is exact whenever the two
   stages coincide — every prod deploy — and `deploy_gate_resolve_export` REFUSES rather than guessing when
   they differ.
