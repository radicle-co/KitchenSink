# 0036 — A preview's services deploy in parallel, and a join asserts the ecosystem

- **Status**: Accepted
- **Date**: 2026-09-07
- **Amends**: [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md) §5 — its ordering clause only. The
  ensure-exists gate itself (§§1–3), its four conditions, `deploy-gate.sh`, and the 401-is-the-PASS smoke
  contract (§4) are untouched and still govern.
- **Drivers**: A preview took 87 minutes on run 34078228894 and ran zero end-to-end tests. Of the 35 minutes
  that remained once two one-off costs were removed, 33 were two deploy jobs waiting on each other for an
  ordering that was never a data dependency.
- **Relates to**:
  [ADR-0032](0032-deployed-ecosystem-test-tier.md) — every deployed validation tier hangs off
  `deploy-preview`, so its wall clock is the tier's time-to-first-signal;
  [ADR-0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md) — a per-PR food database is created
  by food's schema stack, which is why "both food stacks exist" was worth asserting at all;
  [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md) — each service already deploys its schema
  stack ahead of its own consumers, so neither service needs the other's schema to be ordered.

## Context

`deploy-recipe` carried `needs: deploy-food` and `if: !cancelled() && needs.deploy-food.result != 'failure'`.
ADR-0010 §5 states the reason plainly: _"Recipe requires food's origin… A food deploy that fails still blocks
recipe, on purpose."_ The property being bought is real and worth keeping — a preview must never report a
wired ecosystem behind a green check, which is the failure #124 was written for.

Three things about that edge are now established by measurement rather than assumption.

**It is not a data dependency.** Recipe obtains food's origin from
`packages/services/food-service/infra/bin/printFoodHost.ts`, which calls the pure
`foodServiceOriginForStage(stage, domainName)`. It computes a hostname from two strings and touches no
network. Recipe has never needed food to have finished in order to know where food will be.

**It cost roughly thirteen minutes of every run.** On run 34078228894 the two jobs took 2404s and 2683s. Both
figures carry a one-off: food spent 1523s deleting a VPC Lambda whose ENIs AWS had to reclaim (a one-time
ADR-0035 cutover), and recipe spent 1570s deliberately waiting out the ADR-0007 nightly-stop boundary.
Steady-state they are 881s and 1113s, run back to back, on a critical path that is otherwise 121s. The
entire merge gate — 34 jobs — completes at 06:38 and is never on that path.

**Belt 2's own stated justification no longer exists.** ADR-0010 §5 kept
`needs.deploy-food.result != 'failure'` rather than plain `needs` semantics so that `workflow_dispatch` with
`service: recipe` — where `deploy-food` genuinely skips — stayed runnable. `_sandbox-preview.yml` has no
`service` input; `sandbox-deploy.yml` forwards only `stage` and `forced`; and `deploy-food` carries no
job-level `if:` at all, so it cannot skip. The condition guards a case the workflow can no longer produce.

One thing the edge did buy beyond ordering, and which a naive parallelisation would have broken: recipe's
origin-resolution step also ran a blocking `describe-stacks` over `kitchensink-food-schema-${STAGE}` and
`kitchensink-food-service-${STAGE}`, failing the job if either was absent. Under parallelism that check
fails on a preview's first run for the ordinary reason that food has not finished yet.

## Decision

The two deploy jobs become peers. `deploy-recipe` loses `needs: deploy-food` and its `if:` entirely, making
it structurally identical to `deploy-food`: unconditional when the workflow is called.

The guarantee moves from a linear edge to a **join**. A third job, `ecosystem-smoke`, needs both deploys and
runs only when both report `success`. It owns exactly the two cross-service assertions — that the running
recipe task is configured for this stage's food service, and that the food origin answers — consuming three
strings published as `deploy-recipe` job outputs. It binds no `environment`, holds no AWS credentials, and
re-derives nothing.

The recipe-only half of the smoke — health, CORS preflight, image currency — stays inside `deploy-recipe`.
That is not a preference: `deployVerificationCoverage.test.ts` requires the job that pushes an image to prove
in that same job what is running, and the currency check reads `steps.gate.outputs.deploy`, a step context
that cannot cross a job boundary.

The blocking `describe-stacks` loop is **deleted**, not relocated. Its claim is entailed by the graph:
`ecosystem-smoke` requires `deploy-food.result == 'success'`, and food's own ensure-exists gate enumerates
both food stacks and deploys on any non-usable status, so a successful food deploy already means both stacks
are usable. Because that entailment lives in another job's step where nothing else would notice it rotting,
`deployedE2eEntrypoint.test.ts` analyzer 7 asserts that food's gate still names both stacks.

## Alternatives considered

**Keep the serial edge.** Costs ~13 minutes on every run that deploys both services, and pushes a run that
starts late enough into the ADR-0007 nightly-stop window — which is exactly how run 34078228894 failed.

**Move the whole smoke into the join.** Forbidden by `deployVerificationCoverage.test.ts`, and it would
delay the image-currency signal by a job for no gain.

**Give the join AWS credentials and let it re-probe the food stacks.** Buys nothing over the graph
derivation, and costs an `environment:` binding that drags the job into `reclamationNeverGated.test.ts`.

**Order recipe behind food only when food actually deploys.** A job-level `if:` cannot read a step output of
another job, so this reduces to the edge it replaces.

## Consequences

**On a run where food fails, recipe still deploys.** This is the accepted cost and it is a genuine narrowing
of ADR-0010's intent, from _prevention_ of a half-wired preview to _detection_ of one. Recipe completes a
full deploy — an ECR push and four `cdk deploy` passes — producing a preview wired to a food origin that is
absent or broken. `ecosystem-smoke` never runs, so no green check ever claims the ecosystem is wired, and
`deploy-preview.result` is `failure` for the seven downstream tiers exactly as before. But between runs a
human opening `pr-{N}` sees `catalogAvailability: 'unavailable'`, which is the user-visible symptom ADR-0010
was written to eliminate. It self-heals on the next push, whose food gate sees a non-usable stack or a
non-200 origin and redeploys.

**A preview's first run has a transient window** where recipe's tasks start with `FOOD_SERVICE_URL` naming a
host whose ALB rule and A-record are still minutes away. This is non-fatal by construction: the environment
schema validates the URL's _shape_, not its reachability, so nothing crash-loops and the catalog degrades to
`unavailable` until food finishes.

**One extra job runs on every preview**, costing roughly 70–90 seconds of checkout, Node setup and cache
restore. The net saving is `min(food, recipe) − 90s` ≈ 13 minutes, and it materialises only when both jobs
do real work.

**Operability improves.** An ecosystem failure now has its own named check rather than being the last step of
"Deploy recipe sandbox". On run 34078228894 it would have read as `Smoke test the preview ecosystem ✗`.

**ADR-0010 §§1–4 stand entirely**, as do the ALB priority allocation, the NAT consumer list, and the
`deploy-preview.result` contract that ADR-0032's tiers consume.

## Residual risk

The 13-minute figure is derived from one run's steady-state timings with two one-off costs removed by
subtraction, not from a run observed without them. The first parallel run is the measurement that confirms
it.

GitHub's behaviour for job outputs published by one job of a reusable workflow and consumed by another job of
the same workflow is documented but was not previously exercised in this repository. A guard suite cannot
observe it; only a run can.
