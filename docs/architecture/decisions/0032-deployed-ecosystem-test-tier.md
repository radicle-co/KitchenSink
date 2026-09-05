# 0032 — A test that boots its own backend is not an end-to-end test: the deployed-ecosystem tier

- **Status**: Accepted — **§§1, 4 and 7 REWRITTEN by owner ruling 2026-09-05**; §§2, 3, 5 and 6 stand unchanged
- **Date**: 2026-09-04 (rewritten 2026-09-05)
- **Deciders**: owner, platform
- **Relates to**: [ADR-0001](0001-sandbox-front-end-addressing.md) (preview reachability — the browser half is
  blocked on it), [ADR-0003](0003-shared-alb-per-stage.md) (the shared ALB the deadlock below runs through),
  [ADR-0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md) (Fargate Spot in non-prod),
  [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md) (the ecosystem guarantee, and §5's belts),
  [ADR-0028](0028-on-demand-sandbox.md) (on-demand previews — amended by this ADR for validation purposes)

## ⚠️ SUPERSEDED IN PART (2026-09-05, owner ruling) — READ THIS BEFORE ANYTHING BELOW

The owner ruled, verbatim, on 2026-09-05:

> "all end to end tests (playwright, e2e, maestro, etc) - which should be hitting remote services - should be
> skipped if the sandbox for the PR is not running. There should also be a manual job that I can trigger that
> will run the end to end tests. **Ignore anything any ADR says: my word is law. Update ADRs if you have to.**
> Right now the pipeline should be green because no end to end tests were run"

**This overturns §1 as originally written.** The version of this ADR dated 2026-09-04 concluded from the
fifteen-day `pr-73` evidence that the local-booting suites should be **kept, renamed "hermetic contract
tests", and left as the hard merge gate on every PR**, with a _second_, deployed tier added beside them. That
conclusion is now wrong. The evidence it was drawn from is not: the fifteen-day record below is the
**motivation** for the ruling, not an argument against it.

**The decision, restated:**

1. **There is ONE end-to-end tier and its target is a deployed environment.** Playwright, the service e2e
   suites, the cross-service linkage suite, Maestro and k6 all drive a real deployed origin — the PR's own
   sandbox, or production. None of them boots or mocks the backend it is testing.
2. **Every one of them SKIPS when the PR's sandbox is not running.** A skip is not a pass and not a failure.
   The ruling's last clause is the acceptance criterion: _"Right now the pipeline should be green because no
   end to end tests were run."_ §6 already said this and is unweakened — it now governs **every** e2e-shaped
   tier, not only the API-level one §7 originally scoped it to.
3. **ONE manual job runs the whole suite on demand** — `.github/workflows/deployed-e2e.yml`, §4. That is the
   door for a PR whose sandbox is up, and the only door to production.
4. **There is no separate always-on local-boot e2e tier, and no `Hermetic (…)` e2e gate.** The unit and
   integration tiers are untouched and remain the merge gate — an integration test that stands up Docker
   Postgres and LocalStack is not an end-to-end test and was never in scope of this ruling
   ([`docs/CODING_STANDARDS.md` §7.1a](../../CODING_STANDARDS.md)).

Sections below are marked in place. Nothing is deleted.

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

### 1. ⚠️ SUPERSEDED (2026-09-05, owner ruling): ONE end-to-end tier, and its target is a deployed environment

The taxonomy is the ruling's "update the naming to be correct". A tier's name must state its **target**,
because the fifteen-day failure was a naming failure before it was a testing failure: three suites called
"e2e" and one called "load" all pointed at localhost, and nobody reading a green check could tell. **That
half stands.** What changed on 2026-09-05 is the conclusion drawn from it.

~~| tier | target | may mutate | keeps |~~
~~| ---------------------------- | --------------------------------------------- | ---------- | ----------------------------------------- |~~
~~| **hermetic contract tests** | a backend the job itself boots or mocks | freely | every existing local-booting job, renamed |~~
~~| **deployed-ecosystem tests** | a real deployed origin (per-PR sandbox, prod) | see §4 | the new tier this ADR creates |~~

~~The hermetic tier is **kept, not deleted**. It is fast, it needs no AWS, it runs on every push, and it is
where a wrong `SELECT` or a broken guard is caught cheaply. What it is not, and must never again be labelled
as, is proof that anything is deployed.~~

> ⚠️ **SUPERSEDED (2026-09-05, owner ruling): _"all end to end tests (playwright, e2e, maestro, etc) - which
> should be hitting remote services - should be skipped if the sandbox for the PR is not running."_**
>
> There is **no second, always-on e2e tier**. An end-to-end test targets a deployed environment; when the
> PR's sandbox is not running there is nothing to target, and the job **skips** (§6). The 2026-09-04 answer —
> keep the local-booting suites, rename them `Hermetic (…)`, and make them the hard merge gate — is
> overruled, and with it the "may mutate / keeps" columns above.

**What the tier is now:**

| tier                                                                     | target                                        | runs                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------ |
| **end-to-end** — Playwright, service e2e, cross-service linkage, Maestro | a real deployed origin (per-PR sandbox, prod) | when the PR's sandbox is live, or by manual dispatch   |
| **k6 load**                                                              | the same real deployed origins                | same gate; prod only by hand (§2)                      |
| unit + integration                                                       | in-process code; Docker Postgres, LocalStack  | **every PR, unconditionally — this is the merge gate** |

⛔ **The third row is NOT a survival of the struck "hermetic" tier, and must not be grown back into one.**
Unit and integration tests were never end-to-end tests and were never in the ruling's scope; they stand up a
_dependency_ (a database, an AWS emulator), not the _system under test's deployment_. The distinction the
ruling removes is the one where a suite boots the very service it claims to be testing end-to-end and reports
that as an end-to-end pass. Adding a locally-booted service back under any label — `Hermetic`, `Contract`,
`E2E-local` — re-creates exactly the signal that hid `pr-73` for fifteen days.

⛔ **A skip is not a pass.** The tier must never be a required check that a skipped job satisfies silently
(§6), and no artifact, report or PR description may describe a run in which the e2e tier skipped as
"end-to-end passed". `docs/CODING_STANDARDS.md` §7.1a carries the rule; this ADR carries the reason.

⚠️ **Recorded honestly, for the owner: this trades a coverage property away, and the trade is the ruling's
to make.** A locally-booted suite could seed a fixture, force an error branch, assert a LocalStack side
effect and drive a mocked UI path; a deployed suite cannot. Where that coverage is genuinely load-bearing it
belongs in the **integration** tier, which keeps a real Postgres and a real LocalStack and keeps running on
every PR. Where it cannot be expressed there, it is uncovered on a PR with no sandbox — see _Residual risk_.

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

### 4. ONE manual entrypoint, two profiles — and it runs the WHOLE e2e suite (2026-09-05)

Per the second ruling, restated by the third: a single job the owner can press that runs the deployed e2e
suite — _"There should also be a manual job that I can trigger that will run the end to end tests."_ It has
two profiles, and the difference between them is not a knob — it is a safety boundary.

| profile     | target             | suite                                                                   | trigger                            |
| ----------- | ------------------ | ----------------------------------------------------------------------- | ---------------------------------- |
| **sandbox** | the PR's preview   | **the WHOLE e2e suite** — Playwright, service e2e, linkage, Maestro, k6 | manual dispatch, or a live sandbox |
| **prod**    | production origins | a NON-DESTRUCTIVE subset                                                | manual dispatch + post-deploy gate |

> ⚠️ **AMENDED (2026-09-05, owner ruling): the sandbox profile's suite is EVERY end-to-end tier, not the
> API-level subset §7 originally scoped.** _"a manual job that I can trigger that will run the end to end
> tests"_ — plural, and the same list the ruling opens with: _"playwright, e2e, maestro, etc"_. The entrypoint
> is `.github/workflows/deployed-e2e.yml`. Its `concurrency` group is keyed on the **target stage**, not on
> `github.ref`, and that stays load-bearing now that the suite is larger: `heavy-e2e.yml`'s header records
> commit `bbf7ea7c`, where one job ran from two callers at once against ONE shared sandbox Clerk instance and
> the two Playwright runs each tore down the other's sign-in fixture.

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
ruled this way once, in code, for the mobile tier: `_ci-heavy.yml`'s Maestro stage guard **fails the job** rather than run
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

> ⚠️ **WIDENED (2026-09-05, owner ruling): this section now governs EVERY end-to-end tier**, not only the
> API-level one §7 originally scoped — _"all end to end tests (playwright, e2e, maestro, etc) … should be
> skipped if the sandbox for the PR is not running."_ The rule below is unchanged; its reach is larger.

So the deployed-ecosystem tier **skips** when no sandbox is live, and a skip is not a pass. The distinction
that matters is between _skipping a job_ and _reporting a green result for work that did not happen_: the
first is honest, the second is the failure mode every guard in this repository exists to prevent. The tier
must therefore never be made **required** for merge in a way that a skip would satisfy silently.

⛔ **The deploy job skips too, for the same reason and NOT the same rule.** ADR-0028's gate already returns
`deploy=false` on `intent = false`; this ADR does not weaken that and must not be read as licence to
restore ensure-exists. Rebuilding a reaped environment because a test wanted one is exactly the
_"rebuild every environment on the first push after the reaper ran. Silently. Behind a green check."_ that
ADR-0028 was written to stop. **A validation tier may decline to run; it may not conjure its own target.**

### 7. ⚠️ AMENDED (2026-09-05): the deployed BROWSER half is still BLOCKED — but the answer is a SKIP, not a local fallback

Playwright against a per-PR preview cannot work today, and the blocker is infrastructure, not test code.
ADR-0001's _"Update (2026-07-28)"_ records it: the CloudFront router's Host swap leaves the Next app
terminating the **Vercel deployment host** rather than the public preview origin, so Clerk's handshake
`redirect_url` dead-ends at `vercel.com/login` and Next rejects every Server Action with a 500
(`Origin !== Host`). **Previews are not reachable in a browser.** The proven cure is DNS
(`pr-{N}.sandbox.commise.app` → `cname.vercel-dns.com` plus a per-deployment alias), which is a separate
piece of work.

~~So this ADR ships the **API-level** deployed suite — the service e2e and k6 against real origins — and the
deployed browser half lands when ADR-0001's fix does.~~

> ⚠️ **SUPERSEDED (2026-09-05, owner ruling): the browser suite is IN the tier, and its target is the
> deployment.** The 2026-09-04 shape — ship the API-level tier now, and keep Playwright running locally
> against a self-served `next start` with the API mocked in the meantime — is exactly the arrangement the
> ruling removes: _"all end to end tests (playwright, e2e, maestro, etc) - which should be hitting remote
> services."_ Playwright targets the PR's deployed web origin and **skips** when it is not there (§6), the
> same rule as every other e2e tier.
>
> ⛔ **ADR-0001's blocker does not license a local fallback.** A Playwright job that boots its own web server
> when the preview is unreachable is not a degraded e2e run — it is the `pr-73` signal restored under a
> different name. Until ADR-0001's DNS fix lands, the browser half is expected to be **skipped or failing
> against a live preview, and that is the honest reading**; it is not to be made green by pointing it back at
> the runner. Tracked in _Residual risk_.

⚠️ The gap is real, not a phased nicety: the fifteen-day defect was a **CORS** failure, which is precisely
the class only a browser sees. `deployedSmoke`'s `classifyPreflight` is what stands in for it in the meantime,
and it is a preflight probe, not a browser.

⚠️ **The mobile half's device layer is untouched by all of this, and it is worth saying why.** What changes
for Maestro is the _backend_ it drives (a deployed origin, not a recipe-service container on the runner);
what does not change is that it runs on a real emulator, because a jsdom component tier is structurally
incapable of observing the native tree. Commit `91c38691` is the proof: React Native's Fabric renderer
collapsed a `View` out of the native hierarchy (`ViewShadowNode.cpp`'s `formsStackingContext` / `formsView`
predicates), so a row that rendered and settled on screen had **no accessible name on either native
platform** — and every jsdom test passed, because jsdom has no view flattening to observe. That finding
survives this ruling intact.

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

> ⚠️ **STRENGTHENED (2026-09-05, owner ruling).** The 2026-09-04 text rejected this option as the _target_ of
> the deployed tier while keeping the same jobs alive beside it under a new label. The ruling closes that
> door too: an e2e-shaped job does not get a locally-booted variant, under any name. The only remaining
> local-boot tiers are unit and integration, which test the code and never claim to test a deployment.

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
- ~~**The hermetic tier keeps running on every push and keeps its coverage.** Nothing is deleted; the rename
  is what stops it being mistaken for proof of a deployment.~~
    > ⚠️ **SUPERSEDED (2026-09-05, owner ruling).** There is no hermetic e2e tier. **A PR with no sandbox
    > runs no end-to-end tests at all and is green** — that is the ruling's own acceptance criterion, and it
    > is what the pipeline is expected to show today. What still runs on every push is unit + integration,
    > which is the merge gate (§1).
- **The deployed browser half is owed**, and with it the CORS class the original defect belonged to.
- **Coverage that only a locally-booted e2e run could reach is now conditional on a live sandbox** — seeded
  fixtures over HTTP, forced error branches, mocked degraded paths. Move what matters into the integration
  tier; what cannot move is listed under _Residual risk_ rather than quietly dropped.

## Residual risk

- ⚠️ **The prod post-deploy gate's non-destructive subset is a curated list, and curated lists rot.** The
  same lesson ADR-0004's NAT consumer list and ADR-0003's priority constants both taught. A spec added to
  the "safe" set that later gains a write becomes a production writer with no signal. The durable form is a
  property the suite itself asserts, not a list someone maintains; that is not built here.
- ⚠️ **Nothing yet proves the deployed tier end to end.** Its target is a real environment, so its first
  honest run is against a real environment — the same residual ADR-0028 carries for its button.
- ⚠️ **001-SC-009 (10k concurrent, p95 ≤ 500 ms) remains unproven and now explicitly so.** See §3.
- ⚠️ **The mobile (Maestro) tier is OUT OF SCOPE for the prod profile**, by `_ci-heavy.yml`'s own Maestro
  stage guard, which refuses any stage but sandbox. ⚠️ Line references removed 2026-09-05 — the guard moved
  when the tier was re-pointed, and it now has two shapes: a **notice + skip** when the resolved stage is not
  sandbox on a normal run, and a hard **`::error::` + failure** on an explicit dispatch that names another
  stage. Both refuse; only the second is loud. Extending the "always run against
  production" ruling to mobile would require overturning that guard, which is a separate decision with a
  separate blast radius.
- ⚠️ **A prod k6 dispatch is a load generator aimed at production.** It is manual-only, which is a procedural
  control, not a technical one. Nothing here bounds the rate an operator can type.

### Added 2026-09-05, with the ruling

- ⛔ **A PR with no sandbox now has NO end-to-end signal of any kind, and that is the accepted posture.**
  Under the 2026-09-04 shape a mislabelled-but-real suite still ran; under the ruling it does not run at all.
  The exposure this leaves is the mirror of the one it closes: `pr-73` was fifteen days of green over a stale
  deploy, and this is green over an untested one. The two are not equivalent — a skip claims nothing while a
  green claims something false — but the honest statement is that **merging a PR that never had a sandbox
  means merging code no end-to-end test has ever driven.** The mitigations are the manual entrypoint (§4) and
  pressing `sandbox-up` before merge; neither is enforced by a check.
- ⚠️ **The coverage the old local e2e suites uniquely held is not all re-homed.** A deployed tier cannot seed
  a fixture, force a 500, or drive a mocked degraded branch, and the integration tier does not drive the
  service over its real HTTP surface for every one of those cases. No audit has been done of what falls
  between the two. **Flagged for the owner rather than assumed away**; the work of moving those cases into
  the integration tier is owed and not done here.
- ⚠️ **Playwright's deployed target is not browser-reachable today** (§7, ADR-0001). Until that infra fix
  lands the browser tier cannot go green against a preview, and it must not be made green by re-pointing it
  at the runner.
- ⚠️ **`E2E` naming is now the norm rather than the exception.** The 2026-09-04 rename moved every
  local-booting job to `Hermetic (…)`; under the ruling those jobs either target a deployment (and are `E2E`
  again) or are unit/integration jobs that never claimed otherwise. The invariant that a job's displayed
  name states its target is unchanged and still enforced — what changed is which side of it these jobs sit on.
