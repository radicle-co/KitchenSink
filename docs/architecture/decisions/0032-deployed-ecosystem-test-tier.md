# 0032 — A test that boots its own backend is not an end-to-end test: the deployed-ecosystem tier

- **Status**: Accepted
- **Date**: 2026-09-04
- **Deciders**: owner, platform
- **Relates to**: [ADR-0001](0001-sandbox-front-end-addressing.md) (preview reachability — the browser half is
  blocked on it), [ADR-0003](0003-shared-alb-per-stage.md) (the shared ALB the deadlock below runs through),
  [ADR-0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md) (Fargate Spot in non-prod),
  [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md) (the ecosystem guarantee, and §5's belts),
  [ADR-0028](0028-on-demand-sandbox.md) (on-demand previews — amended by this ADR for validation purposes)

## Context — the failure this tier exists to catch

`packages/services/recipe-service/infra/smoke/deployedSmoke.ts:11-13` records it, and the sentence is the
whole argument for this ADR:

> A stale, pre-CORS recipe build served `pr-73` for fifteen days while every existing signal stayed green:
> `GET /health` answered 200 (it was running, just old), `cdk synth` exited 0 (the SSM dependency resolves
> at deploy time), and k6 / Playwright / Maestro / integration all passed because each boots or mocks its
> own backend.

Read the last clause slowly. **Every tier this repository calls "end-to-end" supplied its own backend.** The
k6 job in `.github/workflows/_ci-heavy.yml` builds a recipe-service Docker image and boots it under a
dev-auth bypass against a local Postgres and LocalStack (`Boot recipe-service (Docker, dev-bypass)`,
`_ci-heavy.yml:682`; the food half does the same at `:1003`). The web Playwright suite intercepts the
recipe-service HTTP contract — `accountDangerZone.spec.ts`'s own docstring says _"the destructive erasure
hits a MOCK, not the live backend"_. Maestro boots recipe-service in Docker too (`_ci-heavy.yml:323`).

Those are all good tests. **None of them can observe a deployed system**, because none of them talks to one.
A suite that supplies its own dependency proves the code; it is structurally incapable of proving the
deploy, the wiring, the DNS, the listener rule, the image tag, or the schema that actually shipped. Fifteen
days of green is the measurement of that gap.

The owner's rulings, verbatim:

> "the k6 tests are wrong because they are running against the incorrect services - local is not a valid
> target. None of the end to end tests should be testing against local services in the pipeline."

> "Absent is fatal because a PR with no deployed target cannot be validated. ADR 28 needs to be updated. All
> the end to end tests should be skipped if nothing sandbox is running and I should have a single e2e job
> that I can manually run that will run all end to end tests. Also update the naming to be correct"

> "K6 should test the sandbox for the PR. We should still be able to run k6 in the prod pipeline by
> triggering the job manually. End to end tests should always run against production."

## Decision

### 1. Two tiers, named for what they actually do

The taxonomy is the ruling's "update the naming to be correct". A tier's name must state its **target**,
because the fifteen-day failure was a naming failure before it was a testing failure: three suites called
"e2e" and one called "load" all pointed at localhost, and nobody reading a green check could tell.

| tier                         | target                                        | may mutate | keeps                                     |
| ---------------------------- | --------------------------------------------- | ---------- | ----------------------------------------- |
| **hermetic contract tests**  | a backend the job itself boots or mocks       | freely     | every existing local-booting job, renamed |
| **deployed-ecosystem tests** | a real deployed origin (per-PR sandbox, prod) | see §4     | the new tier this ADR creates             |

The hermetic tier is **kept, not deleted**. It is fast, it needs no AWS, it runs on every push, and it is
where a wrong `SELECT` or a broken guard is caught cheaply. What it is not, and must never again be labelled
as, is proof that anything is deployed. `docs/CODING_STANDARDS.md` §7.1 carries the distinction between the
two tiers; this ADR carries the reason.

### 2. k6 targets the per-PR sandbox, and prod only by hand

Per the third ruling. The load scripts point at the PR's own deployed origins
(`recipe-pr-{N}.commise.app`, `food-pr-{N}.commise.app`), not a container the job started. The prod pipeline
keeps a k6 path, **manual dispatch only** — a load generator that fires automatically at production on
merge is a self-inflicted incident, and ADR-0024's spend ceiling is not the only budget a runaway can spend.

### 3. ⛔ A per-PR k6 run is a same-shape REGRESSION DETECTOR, not a capacity number

This is the single most misreadable consequence here, so it is stated as a prohibition: **do not quote a
per-PR k6 result as a throughput or concurrency figure, and do not "fix" the harness until it produces
one.** Four independent reasons, each sufficient:

- **The target is not production-shaped.** A per-PR service is one 0.5-vCPU / 1 GB task at
  `desiredCount = 1` on `FARGATE_SPOT` (ADR-0008; ADR-0010's `FOOD_DESIRED_COUNT=1`), sharing a
  `db.t4g.micro` (`packages/infra/global/lib/platform/DataStack.ts:113-115`) with the sandbox tier and every
  other live preview. Prod is `db.t4g.small`, on-demand Fargate, two tasks. A number measured on the first
  says nothing about the second, and a **preemptible** task says nothing reproducible about either.
- **The neighbours are not controlled.** ADR-0006 gives each PR a logical database on one shared instance.
  Two previews load-testing at once measure each other.
- **Rate limits either bind or are disabled, and both readings are worthless.** The recipe service's
  `UserThrottlerGuard` keys per authenticated user, not per IP
  (`packages/services/recipe-service/src/common/throttle/userThrottler.guard.ts`), so the harness routes
  around it with a distinct-user pool — but minting that pool goes through Clerk's Frontend API, which
  **is** per-IP rate limited, which is exactly why `provision-pool.mjs` exists to mint through the Backend
  API instead (`packages/tools/loadtest/README.md`). One runner is one IP. And the escape hatch is worse
  than the trap: cranking `RATE_LIMIT_*` (`recipe-service/src/config/config.types.ts:361-381`) to get clean
  numbers means the run **no longer proves the production limits behave**, which is the one property a
  load test against a deployed target was uniquely able to check.
- **The generator cannot reach the headline.** 001-SC-009 is _p95 ≤ 500 ms at 10,000 concurrent users_
  (`specs/001-commise-recipe-app/spec.md:451`). The repository already concedes a single runner cannot
  produce it: _"A single k6 runner cannot honestly generate 10k VUs"_
  (`packages/services/recipe-service/tests/load/lib/common.js:125-127`, and the same sentence in that
  suite's README §"SC-009 at 10k concurrent" and in identity's).

What a per-PR run **is** good for is the thing the hermetic run could never do: the same script, the same
thresholds, the same shape, against a real deployment — so a change that doubles a query's cost, drops an
index, or wires a service at the wrong origin shows up as a shifted curve. The thresholds are peak-invariant
by construction (`rampStages`), which is what makes the comparison legitimate at any VU count.

> ⚠️ **001-SC-009 is therefore an ACCEPTED, UNPROVEN gap, recorded here rather than left implicit.** Nothing
> in this repository has ever validated 10,000 concurrent users, and nothing this ADR builds will. Closing
> it needs distributed execution (k6 Cloud or a fleet) against a production-shaped stage, which is its own
> decision with its own bill. Until that happens, no artifact may claim SC-009 is met.

### 4. ONE manual entrypoint, two profiles

Per the second ruling: a single job the owner can press that runs the deployed e2e suite. It has two
profiles, and the difference between them is not a knob — it is a safety boundary.

| profile     | target             | suite                    | trigger                            |
| ----------- | ------------------ | ------------------------ | ---------------------------------- |
| **sandbox** | the PR's preview   | the FULL mutating suite  | manual dispatch                    |
| **prod**    | production origins | a NON-DESTRUCTIVE subset | manual dispatch + post-deploy gate |

The third ruling — _"End to end tests should always run against production"_ — is honoured in **direction**
and narrowed in **shape**, and the narrowing is recorded in §5 with the evidence it rests on.

### 5. ⛔ Why production gets a NON-DESTRUCTIVE subset, and not the full suite

The full web suite is not a read-only observer of an environment. It **is** a data-producing workload:

- **It creates real Clerk users.** `tests/e2e/utils/testUser.ts:60` calls `clerk.users.createUser`, and the
  suite runs **8 concurrent shards** (`.github/workflows/_ci.yml:2033-2048`), each provisioning its own.
  `tests/e2e/utils/runFixtureIdentity.ts:11` records the bug that taught this: _"A shared, fixed USERNAME
  was the same bug's second face: concurrent `createUser` calls raced."_ Pointed at prod, that is eight
  racing writes into the **production Clerk tenant** on every run.
- **The suite writes real rows.** Of 46 spec files, the great majority mutate — recipes
  (`recipeCrud.spec.ts`), collections (`collections.spec.ts`), ratings (`recipeRating.spec.ts`), photo
  uploads (`recipePhotos.spec.ts`), authored foods (`authoredFoodCreate.spec.ts`), versions
  (`versions.spec.ts`).
  ⚠️ The exact mutating/read-only split is a **derivation, not a pinned figure**: no test asserts it, a
  grep-based classification over the 46 files is noisy in both directions, and it will drift. The decision
  does not depend on the count — it depends on the shape, which is that most of the suite writes.
- **One spec drives GDPR erasure.** `accountDangerZone.spec.ts` walks the phrase-gated, donate-election
  account-erasure flow. It mocks the recipe API _today_ — which is precisely the property this ADR is
  removing from the deployed tier.

**Real users' data and the production Clerk tenant are not a test fixture.** The repository has already
ruled this way once, in code, for the mobile tier: `_ci-heavy.yml:171-178` **fails the job** rather than run
Maestro against any stage but sandbox, because _"it provisions a Clerk sign-in test user in the '{stage}'
tenant and tests nothing that is prod-shaped"_ — and it fails loudly rather than skipping, so a green heavy
run cannot mean the tier ran nothing. This decision applies the same reasoning to the web suite.

The prod profile therefore runs the read-only, non-mutating specs against production as a post-deploy gate —
enough to catch the fifteen-day class (stale build, absent CORS, unreachable origin, wrong wiring) without
authoring anything.

> **If the full suite against prod is ever wanted, it is a SEPARATE decision, and it needs two things this
> one does not build**: a dedicated production test account with a bounded blast radius, and a cleanup path
> that provably reclaims everything the run authored. Do not close that gap by pointing the existing suite at
> prod and hoping the teardown holds — a cancelled shard is killed before Playwright's `globalTeardown` runs
> (`.github/workflows/_ci.yml:2028-2031`), which is how the sandbox tenant already leaks fixture users.

### 6. "No sandbox live" is a SKIP, never a failure — and this AMENDS ADR-0028's premise

ADR-0028 §4 established that under on-demand previews, _"absent stops meaning 'broken' and starts meaning
'deliberately reaped at midnight'"_ — and made `intent` a required first parameter of `deploy-gate.sh
decide` so an absent stack no longer triggers a deploy.

That premise is correct **for deployment** and the owner has now overturned it **for validation**:

> "Absent is fatal because a PR with no deployed target cannot be validated."

Both readings stand, because they answer different questions:

| question                                       | absent means                             | outcome                          |
| ---------------------------------------------- | ---------------------------------------- | -------------------------------- |
| _should I build this preview?_ (ADR-0028 §4)   | deliberately reaped — do not rebuild it  | **skip the deploy**              |
| _may I claim this PR is validated?_ (this ADR) | **fatal** — there is nothing to validate | **skip the tier, claim nothing** |

So the deployed-ecosystem tier **skips** when no sandbox is live, and a skip is not a pass. The distinction
that matters is between _skipping a job_ and _reporting a green result for work that did not happen_: the
first is honest, the second is the failure mode every guard in this repository exists to prevent. The tier
must therefore never be made **required** for merge in a way that a skip would satisfy silently.

⛔ **The deploy job skips too, for the same reason and NOT the same rule.** ADR-0028's gate already returns
`deploy=false` on `intent = false`; this ADR does not weaken that and must not be read as licence to
restore ensure-exists. Rebuilding a reaped environment because a test wanted one is exactly the
_"rebuild every environment on the first push after the reaper ran. Silently. Behind a green check."_ that
ADR-0028 was written to stop. **A validation tier may decline to run; it may not conjure its own target.**

### 7. The deployed BROWSER half is BLOCKED, and only the API-level suite ships now

Playwright against a per-PR preview cannot work today, and the blocker is infrastructure, not test code.
ADR-0001's _"Update (2026-07-28)"_ records it: the CloudFront router's Host swap leaves the Next app
terminating the **Vercel deployment host** rather than the public preview origin, so Clerk's handshake
`redirect_url` dead-ends at `vercel.com/login` and Next rejects every Server Action with a 500
(`Origin !== Host`). **Previews are not reachable in a browser.** The proven cure is DNS
(`pr-{N}.sandbox.commise.app` → `cname.vercel-dns.com` plus a per-deployment alias), which is a separate
piece of work.

So this ADR ships the **API-level** deployed suite — the service e2e and k6 against real origins — and the
deployed browser half lands when ADR-0001's fix does. ⚠️ That is a real gap, not a phased nicety: the
fifteen-day defect was a **CORS** failure, which is precisely the class only a browser sees. `deployedSmoke`'s
`classifyPreflight` is what stands in for it in the meantime, and it is a preflight probe, not a browser.

## Alternatives rejected

### A. A persistent shared non-prod tier that e2e can always point at — **≈ +$48/month, and refused for a DEADLOCK**

The obvious answer to "e2e needs a deployed target" is a target that is always deployed. It costs about
$48/month, and **the money is not why it is refused.**

Such a stack imports the shared sandbox ALB's HTTPS listener ARN:
`Fn.importValue('kitchensink-alb-sandbox:SharedAlbHttpsListenerArn')` at
`packages/services/food-service/infra/lib/FoodServiceStack.ts:843` and
`packages/services/recipe-service/infra/lib/RecipeServiceStack.ts:553`, consumed by the
`ApplicationListenerRule` each stack attaches at `:885` and `:594` respectively (ADR-0003 — services add
host rules, they do not own an ALB).

**CloudFormation refuses to delete a stack whose exports are imported.** ADR-0028's Update of 2026-08-30
records this happening for real, with the console text:

```
Delete canceled. Cannot delete export
  kitchensink-identity-service-sandbox:IdentityServiceLogGroupName
as it is in use by kitchensink-identity-webhooks-sandbox.
```

A permanent e2e stack importing the sandbox listener is that same edge, deliberately made permanent. The
hourly reclaim step in `.github/workflows/sandbox-reconcile.yml:243-247` would fail on it **every hour** —
and it carries **no `continue-on-error` by explicit decision**, recorded in its own comment at
`sandbox-reconcile.yml:233-241`: _"`continue-on-error: true` reports the JOB green, which means an ALB that
never deletes bills forever behind a passing check."_ So the outcome is not a quiet degradation. It is an
hourly red run, plus the permanent forfeit of ADR-0028's measured **$23.73/month** ALB reclamation, plus
the $48 the tier itself costs.

⚠️ Cost derivation — arithmetic over published us-east-1 rates and this repository's own prior derivations,
**not** a Cost Explorer read:

| item                                  | rate            | source                                    |
| ------------------------------------- | --------------- | ----------------------------------------- |
| ALB + 2 public IPv4, 24/7             | $23.73 / mo     | ADR-0028 "Update (2026-08-30)"            |
| food API, 0.5 vCPU / 1 GB, Spot       | $5.50 / mo      | ADR-0010 cost table                       |
| food worker, 0.25 vCPU / 0.5 GB       | $2.75 / mo      | ADR-0010 cost table                       |
| recipe API, 0.5 vCPU / 1 GB, Spot     | $5.50 / mo      | same task size, same rate                 |
| identity API, 0.5 vCPU / 1 GB, Spot   | $5.50 / mo      | same task size, same rate                 |
| one 0.25-vCPU worker (change-refresh) | $2.75 / mo      | same task size, same rate                 |
| **subtotal**                          | **$45.73 / mo** |                                           |
| CloudWatch ingestion + idle tail      | ~$2 / mo        | rounded allowance, not derived per-metric |
| **≈ total**                           | **≈ $48 / mo**  |                                           |

### B. Auto-deploy every PR so a target always exists — **≈ +$173/month at 7 concurrent PRs**

This restores exactly the bill ADR-0028 removed. ADR-0028 measured a **$398/month** run rate (20–27 Aug 2026) under this posture and named its cause: _"per-PR previews standing for nineteen days at a time."_

⚠️ Same attribution — derived arithmetic, not a Cost Explorer read:

| item                                                      | derivation                                 |
| --------------------------------------------------------- | ------------------------------------------ |
| per-PR ecosystem (food API + worker, recipe API + worker) | $5.50 + $2.75 + $5.50 + $2.75 = **$16.50** |
| per-PR CloudWatch / ECR / NAT share                       | ≈ $1.36                                    |
| **per PR**                                                | **≈ $17.86 / mo**                          |
| × 7 concurrent PRs                                        | ≈ $125.02 / mo                             |
| + the always-on shared tier from (A)                      | + $48 / mo                                 |
| **≈ total**                                               | **≈ $173 / mo**                            |

Rejected on the cost alone, and rejected twice over because ADR-0028 §4's whole point is that a preview
appearing without a press is the silent-rebuild failure.

### C. Keep pointing e2e and k6 at a locally booted service — **status quo**

This is what shipped `pr-73` stale for fifteen days behind four green suites. Rejected by the ruling, and by
the evidence in `deployedSmoke.ts`'s own docstring.

### D. Run the FULL suite against production

Rejected in §5. Recorded here so nobody re-proposes it as a simplification: it is not a simplification, it
is eight concurrent writers in the production Clerk tenant and a GDPR erasure walk.

## Consequences

- **A PR whose sandbox is down gets no deployed-ecosystem result at all** — a skipped job, no green, no red.
  That is the intended reading of _"absent is fatal"_: nothing is claimed, rather than something false being
  claimed. It also means the tier cannot be a blocking required check in its current shape.
- **k6 results become comparable across runs and incomparable to a capacity target.** §3 is the standing
  warning; a report quoting a per-PR k6 number as throughput is wrong on its face.
- **Prod gains a post-deploy e2e gate** it did not have, at the cost of that gate being narrower than the
  sandbox one. The asymmetry is deliberate and is the whole content of §5.
- **The hermetic tier keeps running on every push and keeps its coverage.** Nothing is deleted; the rename
  is what stops it being mistaken for proof of a deployment.
- **The deployed browser half is owed**, and with it the CORS class the original defect belonged to.

## Residual risk

- ⚠️ **The prod post-deploy gate's non-destructive subset is a curated list, and curated lists rot.** The
  same lesson ADR-0004's NAT consumer list and ADR-0003's priority constants both taught. A spec added to
  the "safe" set that later gains a write becomes a production writer with no signal. The durable form is a
  property the suite itself asserts, not a list someone maintains; that is not built here.
- ⚠️ **Nothing yet proves the deployed tier end to end.** Its target is a real environment, so its first
  honest run is against a real environment — the same residual ADR-0028 carries for its button.
- ⚠️ **001-SC-009 (10k concurrent, p95 ≤ 500 ms) remains unproven and now explicitly so.** See §3.
- ⚠️ **The mobile (Maestro) tier is OUT OF SCOPE for the prod profile**, by `_ci-heavy.yml:171-178`'s own
  guard, which refuses any stage but sandbox and fails rather than skips. Extending the "always run against
  production" ruling to mobile would require overturning that guard, which is a separate decision with a
  separate blast radius.
- ⚠️ **A prod k6 dispatch is a load generator aimed at production.** It is manual-only, which is a procedural
  control, not a technical one. Nothing here bounds the rate an operator can type.
