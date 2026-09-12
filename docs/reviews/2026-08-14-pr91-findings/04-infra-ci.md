# 04 — Infrastructure, CI and deploy

**Mode**: REVIEW (read-only). **Date**: 2026-08-14. **Branch**: `chore/code-quality-enforcement-phase-1-2`.
**Scope**: `packages/infra/**`, `packages/services/*/infra/**`, `.github/workflows/**`, `.github/scripts/**`,
`scripts/**`, plus the feature specs that prescribe infrastructure (006, 011, 012, 013, 014).

No AWS API call of any kind was made. Every claim below is anchored to a file read in this tree or to the
AWS documentation URL cited in its **Verified** field.

## Governing decisions read in full before forming an opinion

`CLAUDE.md` "Deliberate decisions — looks wrong, isn't" (all nine entries); ADR-0002, 0003, 0004, 0005,
0006 (via ADR-0017/0019 citations), 0007, 0008, 0010, 0013, 0017 (**including its 2026-08-14 Amendment**), 0019. Nothing below proposes reversing a decision those record. Two findings are the **firing of a trigger
those documents themselves wrote down**, and are reported as such rather than as surprises.

The two most load-bearing quotes for what follows:

> ADR-0003, Consequences: "**A 9th service** needs the geometry re-cut (narrower bands ⇒ lower PR ceiling,
> or a second listener). It fails at synth, loudly."

> `CLAUDE.md` §Deliberate: "⚠️ **Priorities come from ONE allocator — `packages/infra/alb`
> (`listener-priority.ts`) — never from a per-service constant.**"

---

## F-I1

**Severity**: High (planning blocker; fails at build, not in production)

**File**: `packages/infra/alb/src/listener-priority.ts:74` (`EPHEMERAL_SERVICE_SLOTS = 8`) and
`packages/infra/alb/src/listener-priority.ts:102` (`EPHEMERAL_SLOT_ORDER = ['identity','food','recipe']`)

**What breaks**: The accepted service roster has already reached **nine** ALB-fronted deployables against
**eight** reserved ephemeral slots. The ninth service to be registered makes
`packages/infra/alb/src/__tests__/listener-priority.test.ts:80`
(`EPHEMERAL_SLOT_ORDER.length <= EPHEMERAL_SERVICE_SLOTS`) go red, and any call reaching
`ephemeralBandsForSlot(8)` throws at `listener-priority.ts:183-189`. The ninth service's PR cannot land
until the geometry is re-cut, and re-cutting moves every currently-deployed per-PR rule.

The roster, each entry anchored:

| #   | Slot | Service                                      | Authority                                                                                                                                                         |
| --- | ---- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0    | `identity`                                   | `listener-priority.ts:102` (registered, deployed)                                                                                                                 |
| 2   | 1    | `food`                                       | `listener-priority.ts:102` (registered, deployed)                                                                                                                 |
| 3   | 2    | `recipe`                                     | `listener-priority.ts:102` (registered, deployed)                                                                                                                 |
| 4   | 3    | `@kitchensink/meal-plan-service`             | ADR-0017 **Amendment (2026-08-14)**, Accepted — "006 gets its own deployable service and its own tables"                                                          |
| 5   | 4    | `digitization-service` (011 image processor) | ADR-0019 §3, Accepted — "a named exception to ADR-0017's 'no new deployable' default"                                                                             |
| 6   | 5    | `circles-service` (011 Family Circles)       | ADR-0019 §3 ⚠️ — "That half is a **separate deployable with its own tables**"; `specs/011-recipe-digitization/tasks.md:57` scaffolds the package                  |
| 7   | 6    | `creator-profiles-service`                   | `specs/012-creator-profiles/plan.md:24`                                                                                                                           |
| 8   | 7    | `cooking-school-service`                     | `specs/013-cooking-school/plan.md:93` — "NestJS 11: authoritative API"                                                                                            |
| 9   | —    | `notification-service`                       | `specs/014-notification-service/plan.md:499` cites ADR-0003's one-ALB rule for it; `plan.md:551` sets an NFR on "ALB 5xx rate on `/api/v1/notifications/publish`" |

**Why it happens**: The geometry was cut for 8 when three services existed and five feature services were
speculative. Four decisions dated **2026-08-14** (ADR-0017's amendment and ADR-0019's three deployables)
converted the speculative into the accepted, all after `listener-priority.ts` was written. The allocator did
exactly what it promised — it will fail loudly rather than alias — so this is the recorded trigger firing,
not a defect in the allocator.

**Smallest fix**: Widen the slot count. The two invariants pinned at
`packages/infra/alb/src/__tests__/listener-priority.test.ts:68` and `:75` are
`S x PER_PR_BAND_WIDTH == 48000` and `S x NAMED_BAND_WIDTH == 1000`, so `S` must divide `gcd(48000, 1000) =
1000`. **`S = 16` is inadmissible** (`1000/16 = 62.5`). The admissible values above 9 are 10, 20, 25, 40, …

Recommend **`EPHEMERAL_SERVICE_SLOTS = 20`, `PER_PR_BAND_WIDTH = 2400`, `NAMED_BAND_WIDTH = 50`**
(`20 x 2400 = 48000`, `20 x 50 = 1000`). That is a three-constant edit; nothing else in the module changes.
It leaves 11 free slots after the roster above, a PR-number ceiling of 2399 (26x headroom at PR ~91), and 50
named-stage slots against the 3 registered at `listener-priority.ts:134`. `S = 10` also works
(`4800`/`100`) but leaves only one spare slot, which is how this finding recurs in a quarter.

Base priorities are untouched: `listenerPriorityForStage` returns `BASE_LISTENER_PRIORITY[service]` before
the bands are consulted (`listener-priority.ts:246-248`), and that `Record` (`:115-119`) is explicit, so
**prod's template does not diff** — the property ADR-0003 verified byte-identically.

Migration safety of the re-cut, computed rather than asserted: a new priority `2000 + 2400s + N` collides
with a live old one `2000 + 6000t + M` only if `2400s + N = 6000t + M`. The only slots with live per-PR
rules are `t ∈ {1,2}` (food, recipe). For `t = 1` the smallest solution needs `N >= 3600`; for `t = 2`,
`N >= 2400`. No PR number in this repo is within three orders of magnitude of that, so no rule can collide
during the transition. (Whether CloudFormation replaces or updates a `ListenerRule` on a `Priority` change is
**not verified** here; it does not affect the collision result.)

Do **not** "reclaim" identity's unused slot 0 to reach exactly nine. ADR-0003 states the reservation is
deliberate — "to avoid a renumber if identity ever gains a per-PR deploy" — and it would leave zero headroom.

**Verified (how)**: Read `listener-priority.ts` in full and its test file's invariant assertions
(lines 63-99, 245-290). Counted the roster by reading ADR-0017's amendment (lines 225-262), ADR-0019 §3, and
grepping each spec directory for `packages/services/*`. Arithmetic done by hand and stated above. Confirmed
no stale per-service resolver survives: `grep -rn "recipeListenerPriorityForStage|foodListenerPriorityForStage"
--include="*.ts" packages/` returns nothing outside `dist/`.

---

## F-I2

**Severity**: High

**File**: `specs/006-meal-planning/plan.md:648`; `specs/006-meal-planning/v-model/architecture-design.md:258-259`;
`specs/006-meal-planning/v-model/hazard-analysis.md:171` (HAZ-042);
`specs/006-meal-planning/v-model/system-test.md:150`;
`specs/006-meal-planning/v-model/peer-review-architecture-design.md:56`

**What breaks**: Feature 006's plan and its whole V-Model chain prescribe **hand-picked listener bands that
are above the AWS ceiling and that bypass the allocator entirely**:

> `plan.md:648` — "**Listener priority**: base stages **400** (identity 100, food 200, recipe 300). Per-PR band
> **50000–59999**, named …"
>
> `architecture-design.md:258-259` — "per-PR band **50000–59999** and named-ephemeral band **60000–69999**,
> disjoint from food (10000/20000) and recipe (30000/40000)."

`ALB_MAX_LISTENER_PRIORITY = 50_000` (`packages/infra/alb/src/listener-priority.ts:51`). Both prescribed
bands lie at or above it. A meal-plan preview at `pr-91` under this plan gets priority `50091`, which AWS
rejects.

The failure mode is precisely the one `listener-priority.ts:47-49` documents: `aws-cdk-lib`'s
`ApplicationListenerRule` "validates only `priority >= 1` and says nothing about the upper bound — so
exceeding this is a DEPLOY-time failure unless we catch it". `assertWithinAlbRange` is the catch, and it is
**only reachable through `listenerPriorityForStage`** — which a stack implementing this plan would not call,
because the plan hands it literal bands instead. So it synthesizes clean and dies halfway through a stack
update.

Three further staleness markers in the same text: the food/recipe bands quoted (`10000/20000`, `30000/40000`)
are the **pre-allocator** per-service scheme ADR-0003 replaced (food's real band is 8000–13999, recipe's
14000–19999); HAZ-042's mitigation column says "mirroring `recipeListenerPriorityForStage`", a symbol that no
longer exists anywhere in the tree; and `peer-review-architecture-design.md:56` records a reviewer who
**"cross-checked"** these numbers and passed them — a review that validated a design overflowing the AWS
ceiling.

**Why it happens**: 006's artifacts were written against the per-service band scheme and were not re-based
when `packages/infra/alb` consolidated allocation. The peer-review step checked the numbers for mutual
disjointness (which they are) but not against `ALB_MAX_LISTENER_PRIORITY` or against ADR-0003's
one-allocator rule, so the stale design passed its own gate.

**Smallest fix**: Replace every numeric band in those five spans with the allocator instruction. Concretely,
`plan.md:648` and `architecture-design.md:258-259` become: _"Listener priority is allocated by
`listenerPriorityForStage` (`@kitchensink/infra-alb`). 006 registers `meal-plan` by appending it to
`EPHEMERAL_SLOT_ORDER` and adding its base priority to `BASE_LISTENER_PRIORITY`; no band constant is written
in this service."_ HAZ-042's mitigation column names the allocator and its range check rather than
`recipeListenerPriorityForStage`. STS-008-B1's assertion (base priority 400) stays valid and is the one number
worth keeping.

This must land **with** F-I1's widening, since registering `meal-plan` is what takes the roster past 8.

**Verified (how)**: Read all five spec locations and `listener-priority.ts:41-51, 182-199, 243-282`.
Confirmed `recipeListenerPriorityForStage` is absent from the tree by grep (0 hits outside `dist/`).
Confirmed the live stacks are clean — `food-service-stack.ts:654` and `recipe-service-stack.ts:438-440` both
call `listenerPriorityForStage` and hold no band constants.

---

## F-I3

**Severity**: Medium

**File**: `docs/architecture/decisions/0003-shared-alb-per-stage.md:99`;
`packages/infra/alb/src/listener-priority.ts:34-36` ("Two ceilings, stated honestly")

**What breaks**: The capacity note records only the **rules** quota, which is _adjustable_. It omits
**Target Groups per Application Load Balancer = 100, which AWS lists as NOT adjustable.** Each service
attaches exactly one target group to the shared ALB alongside its rule, so the two counts move together —
but only one of them can be raised by opening a support case. The documented escape hatch ("raising it is an
ops task", `CLAUDE.md`) does not exist for the harder half.

Arithmetic, using this repo's actual topology:

- Sandbox base rules: **1**. Identity is the only service with a `STAGE=sandbox` base deploy
  (`.github/workflows/sandbox-identity-deploy.yml:10-18, 36`); food and recipe deploy per-PR only
  (`sandbox-deploy.yml:515, 716` — no sandbox-base job exists).
- Per open PR, at the F-I1 roster: **8** rules + **8** target groups (all nine services except identity,
  which ADR-0003 records as having no per-PR deploy).
- `1 + 8P <= 100` → **P <= 12.375**, i.e. **12 concurrent open PRs**, against a limit that cannot be raised.
- Today (3 services, 2 per-PR): `1 + 2P <= 100` → P <= 49. **Not binding now.**

The effective `P` is not the open-PR count but open PRs **plus un-reclaimed previews**, and this repo has a
measured history of those: `.github/scripts/teardown-sandbox-pr.sh:200-202` records "9 stacks across PRs
73/77/78/79/80 sat in DELETE_FAILED", and `:91-96` records 51 leaked environments against 8 open PRs on
2026-08-11. A DELETE_FAILED per-PR stack keeps its rule and its target group.

**Why it happens**: ADR-0003's capacity paragraph was written from the rules quota alone. Target groups are
mentioned three times in the ADR as a thing services create (`:27, :37, :55`) but never as a metered one, and
`grep` finds no reference to the target-group quota anywhere in `packages/infra`, `docs/architecture` or
`CLAUDE.md`.

**Smallest fix**: One sentence appended to ADR-0003:99 and one line added to `listener-priority.ts:34-36`
(making it "three ceilings"): _"Target Groups per Application Load Balancer is also 100 and is **not
adjustable** (AWS ELB quotas, verified 2026-08-14). One service = one rule + one target group, so the two
move together and the non-adjustable one binds first: at 9 services with 8 per-PR deploys the ceiling is 12
concurrent previews, counting un-reclaimed ones."_ If it ever binds, the structural levers are ADR-0003's own
"revisit" clause (a second shared ALB per stage) or collapsing previews onto path rules under one wildcard
host — both are separate decisions, not fixes to make now.

**Verified (how)**: Fetched
https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html on 2026-08-14 —
"Rules per Application Load Balancer (excluding default rules) | 100 | Adjustable: **Yes**" and
"Target Groups per Application Load Balancer | 100 | Adjustable: **No**". Confirmed one target group per
service by `grep -c "new elbv2.ApplicationTargetGroup"` on all three service stacks — result `1` each.
Confirmed the HTTP→HTTPS redirect is a listener _default action_, not a counted rule
(`shared-alb-stack.ts:55-65`, `addAction` with no conditions). Proved the absence of any target-group quota
note by grepping `packages/infra`, `docs/architecture` and `CLAUDE.md`.

---

## F-I4

**Severity**: Medium

**File**: `.github/workflows/sandbox-deploy.yml:626` and `:887`; `.github/workflows/prod-deploy.yml:267, 425,
516`; `.github/workflows/sandbox-identity-deploy.yml:201`; `.github/scripts/teardown-sandbox-pr.sh:250-256`
and `:267-273`

**What breaks**: Two related things.

1. **Container images accumulate without bound.** All three services import a pre-existing repository by
   name — `recipe-service-stack.ts:165` (`kitchensink-recipes`), `identity-service-stack.ts:128`
   (`kitchensink-identity`), `food-service-stack.ts:235` (`kitchensink-food`) — and CI creates each with a
   bare `aws ecr create-repository`, i.e. **no lifecycle policy**. Every deploying PR event pushes a new
   SHA-tagged image (`sandbox-<sha>` for food, `pr-{N}-<sha>` for recipe) into those repositories, and
   nothing anywhere ever deletes an image. Storage grows monotonically at $0.10/GB-month forever. This is
   precisely the leak class ADR-0005 exists for: no cost signal, no alarm, invisible until someone looks.

2. **The teardown's two ECR sweeps can never match anything.** Per-PR ECR repositories do not exist — every
   stack uses `fromRepositoryName` against a shared repo — so `teardown-sandbox-pr.sh:250` (`*:repository/*`
   under the `Environment=pr-{N}` tag sweep) and `:267-273` (`belongs "$repo"`, a _prefix_ rule against names
   that all begin `kitchensink-`) both enumerate and delete nothing, on every run, and report success. That
   is the same "implemented, documented, matches nothing" defect the file itself dissects at length for log
   groups (`pr-scope.sh:66-82`: "ran on every PR close, enumerated every log group, matched NOTHING, and
   reported success — which is how 22 orphans accumulated").

**Why it happens**: Repository creation is imperative and inline (`describe || create`), so there is no
construct to hang a lifecycle rule on and no test that would notice its absence. The ECR sweeps were written
against an assumed per-PR-repository topology that the stacks never adopted.

**Smallest fix**:

1. Add a lifecycle policy at each of the five creation sites, in the same step:
   `aws ecr put-lifecycle-policy --repository-name <repo> --lifecycle-policy-text '<policy>'` where the
   policy expires untagged images after 1 day and keeps the most recent 30 images matching `tagPrefixList:
["sandbox-","pr-"]`. Prod-tagged images (bare `<sha>`) match no rule and are retained unbounded, so
   rollback capability is untouched. The structurally better version is to move repository ownership into a
   CDK construct with `lifecycleRules`, but that is a larger change and this is the smallest correct one.
2. Delete the two dead ECR branches in `teardown-sandbox-pr.sh`, or leave them and add a test asserting no
   stack creates a per-PR repository. Either is fine; leaving a silent no-op that looks implemented is not,
   by this file's own stated doctrine.

**Verified (how)**: `grep -rn "lifecyclePolicy|LifecyclePolicy|put-lifecycle-policy"` over `packages/` and
`.github/` — zero hits. `grep -rn "new ecr.Repository|fromRepositoryName"` over
`packages/services/*/infra/lib` — three hits, all `fromRepositoryName`, zero `new`. Read all five
`create-repository` call sites and both teardown sweeps.

---

## F-I5

**Severity**: Medium (residual — acknowledged in-tree, escalated here with a concrete lever)

**File**: `.github/workflows/sandbox-deploy.yml:558` and `:768` (credential configuration on `deploy-food`
and `deploy-recipe`), read together with `:626` / `:887` (ECR push targets)

**What breaks**: `deploy-food` and `deploy-recipe` run `npm ci` and `docker buildx build` **on the PR
branch's own code**, in a job that has already configured `secrets.AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`. Those are **organization** secrets (stated at `sandbox-deploy.yml:70-73`,
"verified via `gh api repos/:owner/:repo/actions/organization-secrets`"), and an org secret cannot be
scoped to a GitHub Environment — the file says so itself: _"a binding does not yet narrow which jobs can
reach those keys … treat these bindings as plumbing, not as hardening."_

`npm ci` executes dependency lifecycle scripts. So a compromised transitive dependency — or anything on a
same-repo PR branch — runs in a process holding credentials that can deploy CloudFormation and
`ecr:PutImage` into `kitchensink-recipes` / `kitchensink-food` / `kitchensink-identity`. Those repositories
are created with ECR's **default MUTABLE tag setting** (no `--image-tag-mutability IMMUTABLE` at any of the
five creation sites), and they are **the same repositories prod pulls from**. An overwrite of
`kitchensink-recipes:<main-sha>` is served by the next prod deploy or rollback at that tag.

Fork PRs are not the vector — `pull_request` from a fork receives no secrets, so those jobs fail at the
credential step. The vector is branch code and the dependency tree.

**Why it happens**: Static keys predate the OIDC path and are shared across sandbox and prod because there
is one credential pair. The repo is honest about this rather than hiding it: `_ci.yml:21` names the
hardening path, and `zizmor.yml:17-21` records the workflow-level `id-token: write` being removed as dead
privilege precisely because "all 12 `configure-aws-credentials` call sites use static access keys".

**Smallest fix**, in increasing cost:

1. **Do not** set `--image-tag-mutability IMMUTABLE` as the quick win — it breaks the ensure-exists
   self-heal path. ADR-0010's gate re-deploys on an unchanged SHA when a preview is absent or not serving
   (`deploy-gate.sh:119-145`), and food's tag is `sandbox-<sha>`, so the re-push would hit an existing tag
   and fail. This is worth recording because IMMUTABLE is the obvious first idea.
2. Give non-prod its own repositories (`kitchensink-{svc}-sandbox`), so a preview build never writes to the
   repository prod pulls from. One-line change at each of the two sandbox creation sites plus the matching
   `fromRepositoryName` becoming stage-aware. This narrows the blast radius without narrowing the
   credential.
3. The change that actually moves the boundary, and the one `_ci.yml:21` already names: OIDC with
   per-environment roles whose trust policy pins `sub` to `repo:<owner>/<repo>:environment:Sandbox` vs
   `:environment:Production`. The `Sandbox` role then holds no `ecr:PutImage` on the prod repositories at
   all, and `id-token: write` goes back on those jobs only.

**Verified (how)**: Read both job definitions end to end, the org-secret note at `sandbox-deploy.yml:70-80`,
all five ECR creation commands (none passes `--image-tag-mutability`), and `deploy-gate.sh:119-147` for the
unchanged-SHA re-deploy path. **Not verified**: the IAM policy actually attached to the static keys (no AWS
call was made), so the exact reachable action set is assumed from what the workflows exercise. Also not
verified: whether `npm ci --ignore-scripts` would suffice for these jobs — it needs a real run.

---

## F-I6

**Severity**: Low

**File**: `.github/workflows/sandbox-deploy.yml:732` and `:1026`

**What breaks**: On the `workflow_dispatch` path, `github.event.pull_request.number` is empty, so:

- `:732` — `IMAGE_TAG: pr-${{ github.event.pull_request.number }}-${{ github.sha }}` evaluates to
  `pr--<sha>`. Two different dispatched stages at the same commit then share one image tag, which quietly
  contradicts the reasoning written three lines above the push step (`:881-884`: "The tag carries the commit
  SHA and is therefore IMMUTABLE per deploy. That is what makes the currency assertion in the smoke step
  meaningful").
- `:1026` — the smoke is invoked with `--web-origin "https://${STAGE}.sandbox.${DOMAIN_NAME}"`. For a
  dispatched named stage that is `dev.sandbox.commise.app`, a host that does not exist, so the CORS
  assertion reds for a reason unrelated to the deploy.

The rest of the job already handles dispatch correctly — `STAGE` and `RECIPE_ORIGIN` (`:729, :737`) both use
the `github.event.inputs.stage || format('pr-{0}', …)` form. These two lines are the ones that were missed.

**Why it happens**: Two literals were left in place when the dispatch fallback was added elsewhere in the
same `env:` block.

**Smallest fix**: `:732` becomes
`IMAGE_TAG: ${{ github.event.inputs.stage || format('pr-{0}', github.event.pull_request.number) }}-${{ github.sha }}`
— the identical expression already on `:729`. For `:1026`, pass `--web-origin` only when `STAGE` matches
`^pr-[0-9]+$`, mirroring how the food leg of `prod-deploy.yml:650-657` omits the flag when the browser path
does not exist (a rule `prod-deploy-smoke-depth.test.ts` already enforces from `main.ts`).

**Verified (how)**: Read `sandbox-deploy.yml:716-742` and `:1010-1030`, and compared against the correct
dispatch fallback at `:729` and `:737`. Read `prod-deploy.yml:648-662` for the precedent on conditional
`--web-origin`.

---

## Examined and found sound — no finding

Stated explicitly so the absence of a finding is a result, not a gap.

- **`deploy-gate.sh`** — the pure/impure split is real (`decide` at `:69-148` performs no I/O; all AWS and
  HTTP live in `:164-231`). Misuse exits 2 without printing a verdict (`:71-103`), so a malformed input can
  never read as "skip". A `describe-stacks` read failure maps to `ABSENT` (`:164-172`), erring toward
  deploying. `UPDATE_ROLLBACK_COMPLETE` is correctly in the usable set and every `*_IN_PROGRESS` is not
  (`:39-44`). The probe retries before concluding `000` (`:181-191`). Correct.
- **`pr-scope.sh`** — the security boundary holds. `pr_scope_is_token` (`:36`) is anchored `^pr-[0-9]+$`;
  `pr_scope_belongs` (`:44-47`) returns 2, not "no", on a malformed token so a caller that skipped the guard
  fails loudly; the mid-segment regex at `:81` is anchored on **both** sides (`(^|[/-])"$1"([/-]|$)`), and
  `"$1"` is quoted inside `[[ =~ ]]` so its `-` is literal — `pr-5` cannot claim `…-pr-57-…`, `pr-57` cannot
  claim `…-pr-570-…`, and `…-expr-57-…` is excluded by the leading anchor. `pr_scope_environment_belongs`
  (`:129-133`) is exact equality **and** re-checks the protected list, and the delete site re-asserts it a
  second time (`teardown-sandbox-pr.sh:146-150`). No global resource can match.
- **Teardown ordering** — the security-critical DNS/Vercel removal runs first (`:56-78`) with the documented
  DNS-before-claim direction, ECS quiesce runs before any stack delete (`:190-211`), and a failure in any
  step records `teardown_failed` without aborting the rest (`:51`). `ecs-quiesce.sh` discovers clusters
  **only** by exact `Environment=pr-{N}` tag and explicitly declines to match on cluster name (`:43-50`),
  which is the correct call.
- **Skipped-dependency traps** — `deploy-recipe`'s `needs: deploy-food` is double-belted exactly as its
  comment claims: `deploy-food`'s job-level `if:` (`:518-521`) is true for every non-closed `pull_request`,
  and `deploy-recipe` carries `!cancelled() && needs.deploy-food.result != 'failure'` (`:720`). I traced the
  four trigger shapes (`pull_request` open/sync, `pull_request` closed, `schedule`, `workflow_dispatch` for
  each service) and found no path where a skip silently propagates.
- **Reclamation is never gated** — neither `cleanup` nor `reap-abandoned` carries an `environment:` key, and
  `__tests__/reclamation-never-gated.test.ts` enforces it. Both hosted-zone resolution steps use
  `--optional` and never `exit`, with `if: ${{ !cancelled() }}` as an independent second belt
  (`:130, :311`). The reaper's candidate discovery covers every resource class the teardown deletes and is
  asserted by `reaper-discovery-covers-teardown.test.ts`.
- **cdk-nag posture (ADR-0013)** — advisory-by-Decorator is correctly implemented; the attachment is
  discovery-enforced by TypeScript-AST walk rather than regex, raw `AwsSolutionsChecks` is forbidden by
  test, suppressions go through one allowlisted register, and the byte-identical-prod-template property has
  both a positive and a negative control. Nothing to add.
- **RDS blast radius** — `deletionProtection: true` is unconditional across stages
  (`data-stack.ts:179`) with the reasoning written at `:160-178`, including "SANDBOX IS INCLUDED
  DELIBERATELY". This is what bounds the otherwise real hazard that `sandbox-identity-deploy.yml` deploys
  `packages/infra/global/**` from an **unmerged PR branch** (`:10-18`) to the shared sandbox platform: a
  construct-ID or CIDR change that would replace the sandbox VPC and its RDS now fails loudly at
  CloudFormation instead of destroying the database every preview rides. Correctly closed.
- **Smoke depth** — not `/health`-only anywhere it matters. Identity, recipe and food all run the shared
  `deployedSmoke.ts` in `prod-deploy.yml` (`:406, :611, :686`) asserting image currency; recipe additionally
  asserts CORS reachability and cross-service wiring, treating food's `401` as the PASS. Food's missing
  `--web-origin` is **derived, not omitted** — `prod-deploy-smoke-depth.test.ts` reads each service's
  `main.ts` and demands the flag exactly when `enableCors` is present. The sandbox recipe smoke runs
  unconditionally (`:1017`), so a preview left half-wired is reported on a push that deployed nothing.
  Sandbox food has no smoke of its own, but all three ECS services set `circuitBreaker: { rollback: true }`
  (`identity:311`, `food:422`, `recipe:365`), so a failed rollout fails `cdk deploy` and blocks
  `deploy-recipe`. Adequate.
- **GitHub Actions supply chain** — every action is SHA-pinned, `persist-credentials: false` everywhere
  except two declared `# zizmor: ignore[artipacked]` sites with stated reasons, zero `${{ }}` in any `run:`
  body outside `_ci-heavy.yml`, and zizmor runs at an `informational` floor with a maintained findings
  ledger. Above the bar.

---

## Challenges to things marked deliberate

None. Every "looks wrong, isn't" entry I touched — the shared ALB, the t4g.nano NAT, `Environment` tagging
with no denylist, the ensure-exists gate, gp3/Spot, per-stage CIDRs — I found correctly implemented and
correctly reasoned, and I am not proposing to change any of them. F-I1 and F-I3 extend ADR-0003's own
capacity note rather than contradicting it; F-I2 restores compliance with it.

---

## Not examined

- `.github/workflows/_ci.yml` (1304 lines), `_ci-heavy.yml` (1126), `heavy-e2e.yml` (455), `codeql.yml`,
  `claude*.yml`, `food-loadtest.yml`, `recipe-loadtest.yml`, `sandbox-router-deploy.yml`,
  `sandbox-web-preview.yml` — read only by targeted grep for OIDC/permissions/infra references. The test-tier
  wiring and the Argos/k6 legs are unreviewed.
- `prod-deploy.yml` beyond its smoke steps, ECR creation and job/permission structure — the migration and
  global-infra legs (`:195-330`) were not read line by line.
- `packages/apps/commise/web/scripts/{createPreviewDomain,teardownPreviewDomain,previewDomainScope}.ts` and
  their tests — the ordering _contract_ was verified from the ADR and the callers, but the implementations
  were not read.
- `packages/infra/global/lib/**` beyond `shared-alb-stack.ts`, `data-stack.ts:120-195`,
  `sandbox-scheduler-stack.ts:70-120` and `cost-guardrails-stack.ts` (grep only). `NetworkStack`,
  `DomainStack` and `GlobalStack` were not read.
- `packages/services/*/infra/lib/*.ts` in full — I read the ALB/ECR/ECS-relevant regions and grepped for IAM
  wildcards, circuit breakers and removal policies. The full IAM surface of the six service stacks was **not**
  audited; the only `resources: ['*']` found outside `dist/` is
  `sandbox-scheduler-stack.ts:99`, and it is correctly confined to five non-resource-scopable read-only
  Describe/List actions with every mutating action ARN-scoped (`:102-135`).
- `packages/infra/security/**` implementations — reviewed via ADR-0013 and the test docstrings, not by
  reading the Decorator source.
- **No AWS API call of any kind was made**, so nothing here is checked against the live account. Every
  quantity is derived from source or from AWS documentation. The account-id guard in the brief was
  consequently never exercised.
