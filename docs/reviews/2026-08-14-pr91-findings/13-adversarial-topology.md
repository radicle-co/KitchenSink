# 13 — Adversarial systems-design review: service topology

**Mode**: REVIEW, read-only, adversarial. **Date**: 2026-08-14. **Branch**:
`chore/code-quality-enforcement-phase-1-2`. **No AWS API call of any kind was made.**

**Posture**: this document attacks. Where an attack fails against real evidence it is marked
**REFUTED** and the reason is stated, because a review that only finds problems is not a review.

**Read in full before forming an opinion**: ADR-0003, 0004, 0006, 0007, 0008, 0010, 0014, 0016, 0017
(**including its 2026-08-14 amendment**), 0019; `CLAUDE.md` §"Deliberate decisions"; the accepted
service rosters in `specs/005`, `006`, `007`, `009`, `011`, `012`, `013`, `014`;
`packages/infra/alb/src/listener-priority.ts` and its test.

**Deliberate overlap**: `04-infra-ci.md` **F-I1** already records the 8-slot / 9-service collision.
**A-2** below does not restate it — it attacks a _different_ ceiling that no document in this tree
has noticed.

---

## A-1 — The portfolio is already a distributed monolith, and nothing in the tree counts it

**Claim attacked**: ADR-0017's framing that "a new deployable must be justified against what a
deployable costs here" is an operative default that is holding.

**Attack**: it is not holding. It has been overridden four times in three days by four separate
documents, none of which sees the others' totals. No document in this repository states the running
count of accepted deployables, so every individual exception is argued against a portfolio the
arguer believes is 3–4 services large. It is 10.

**Evidence** — the accepted roster, each named in an Accepted spec or ADR:

| #   | Deployable                            | Named at                                                                                                         | Status  |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `identity-service`                    | shipped                                                                                                          | live    |
| 2   | `food-service`                        | shipped                                                                                                          | live    |
| 3   | `recipe-service`                      | shipped                                                                                                          | live    |
| 4   | `meal-plan-service`                   | ADR-0017 Amendment (0017:234); `specs/006-meal-planning/spec.md:38` C-006-001                                    | unbuilt |
| 5   | `ai-service`                          | `specs/005-ai-integration/plan.md:34,56`                                                                         | unbuilt |
| 6   | image-processing service (011 branch) | ADR-0019 §3 (0019:72-90)                                                                                         | unbuilt |
| 7   | `circles-service`                     | `specs/011-recipe-digitization/plan.md:23-25`, and ADR-0019:88-90 explicitly refuses to collapse it              | unbuilt |
| 8   | `creator-profiles-service`            | `specs/012-creator-profiles/plan.md:24,158`                                                                      | unbuilt |
| 9   | `cooking-school-service`              | `specs/013-cooking-school/plan.md:93`                                                                            | unbuilt |
| 10  | `notification-service`                | ADR-0016:319-320; `specs/014-notification-service/plan.md:528-537` (Fargate tasks, task SG, ALB 5xx SLO at :551) | unbuilt |

Verified unbuilt: `ls packages/services/{notification,digitization,circles,creator-profiles,cooking-school,ai,meal-plan}-service`
→ all "No such file or directory". `packages/schemas/` holds exactly `food`, `identity`, `recipe`.
So **7 of 10 deployables and 7 of 10 schema packages are being committed to by documents, with zero
lines of implementation** — the precise condition ADR-0017:46 called out as disqualifying when it
was rejecting three services.

Plus at least 6 worker packages: `recipe-workers` (exists), `digitization-workers`,
`cooking-school-workers`, `ai-workers`, `identity-webhooks` (exists), plus 007's retailer polling
job (ADR-0017 decision 5).

**The edges.** Counted from the specs, not imagined:

| Edge                                                                                 | Kind                       | Source                                       |
| ------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------- |
| recipe → food (search, typeahead per keystroke, `addByName`, `getStatus`, `resolve`) | sync, hot                  | `food-service-clients.factory.ts:35-40`      |
| meal-plan → recipe (batch nutrition projection, chunked)                             | sync, hot                  | `specs/006/plan.md:141,536,614`              |
| recipe/007 → meal-plan (read a plan + entries to generate a list)                    | sync                       | `specs/007/v-model/module-design.md:100-103` |
| recipe/009 → meal-plan (`mealPlanExists`, `fetchMealPlanTotals`)                     | sync                       | `specs/009/v-model/module-design.md:359,910` |
| image service → recipe bulk processor                                                | sync                       | ADR-0019 §3                                  |
| digitization → recipe (recipe versions, audience)                                    | sync                       | `specs/011/plan.md:175-190`                  |
| circles → recipe (audience resolution)                                               | sync                       | `specs/011/plan.md:283-285`                  |
| ai-service → recipe (save a previewed recipe)                                        | sync                       | `specs/005/plan.md:334`                      |
| every service → notification (publish)                                               | async                      | ADR-0019 §4, 014 FR-024                      |
| notification → every client                                                          | async, stateful connection | 014                                          |
| every service → identity/Clerk (verify)                                              | sync                       | shipped                                      |

That is **8 synchronous service-to-service edges**, five of which sit on a user-visible request path,
between deployables that will be released by one owner and a set of agents. A single user action —
"generate a grocery list from my meal plan" — traverses recipe → meal-plan → recipe → food, i.e.
three network hops and two services, to satisfy what ADR-0017:85-87 correctly described as three
foreign keys. That is the textbook definition of a distributed monolith: independent deployables
that cannot be released, tested, or reasoned about independently.

**Operability.** Ten deployables × {Dockerfile, deploy job, smoke test, `CONTRACT_HASH` boot
assertion, logical DB, migration lambda, schema package, client package, ALB rule, target group,
CDK stack, k6 script, four test tiers} is the per-service tax ADR-0017:43-45 itemised — and it
itemised it as a reason to say **no**. The same list, multiplied by 10, is now the accepted plan.
There is no evidence anywhere in the tree that anyone has multiplied it.

**Verdict**: **SURVIVES.** The portfolio is a distributed monolith by the standard definition, and
the governing ADR's own cost model, applied to the accepted roster, forbids it.

**What must change**: one document — an ADR-0020 or an amendment to 0017 — must carry the **roster
table above and its running total**, and every future "new deployable" argument must be made against
that total rather than against the arguer's local view. Without a counter, the default is not a
default; it is a formality that is overridden every time it is invoked.

---

## A-2 — The binding ALB ceiling is target groups (non-adjustable), and the repo has documented the _adjustable_ quota as the binding one

**Claim attacked**: `CLAUDE.md` §Deliberate — "the real capacity limit is **AWS's default 100 rules
per ALB**, not the priority range — with 5+ services and concurrent open PRs that quota binds first,
and **raising it is an ops task**."

**Attack**: the sentence names the wrong quota, and the word "raising" is the tell. _Rules per
Application Load Balancer_ (100) is an adjustable quota — a support ticket. _Target groups per
Application Load Balancer_ (100) is **not adjustable at all**, and one service = one rule **and one
target group** (`ApplicationListenerRule` + `ApplicationTargetGroup` in
`packages/services/recipe-service/infra/lib/recipe-service-stack.ts`,
`packages/services/food-service/infra/lib/food-service-stack.ts`). So the repo has written down the
escapable ceiling as the binding one and has not noticed the inescapable one behind it.

**Evidence**: AWS ELB quotas — "Target groups per Application Load Balancer: 100, not adjustable"
(<https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html>).
ADR-0003's design places every service and every `pr-{N}` preview on **one** shared ALB per stage.

The arithmetic on the sandbox ALB, which is the one that carries previews:

| Roster                         | Base TGs (sandbox) | TGs per open PR                   | Max concurrent open PRs before a hard AWS wall |
| ------------------------------ | ------------------ | --------------------------------- | ---------------------------------------------- |
| today (identity, food, recipe) | 3                  | 2 (identity has no per-PR deploy) | **(100−3)/2 ≈ 48**                             |
| accepted roster (10)           | 10                 | 9                                 | **(100−10)/9 = 10**                            |

**The accepted portfolio cuts the concurrent-open-PR ceiling from ~48 to 10, and the 11th PR fails
as an opaque `TooManyTargetGroups` mid-`cdk deploy`** — not at synth. The allocator range-checks its
own priorities (`listener-priority.ts:213-223`) precisely so that failure class is caught early;
nothing anywhere counts target groups, so this one lands exactly where
`listener-priority.ts:8-9` says a shared-namespace failure must never land: "a collision surfaces
only at deploy… which does not name the other claimant."

Secondary: `specs/005-ai-integration/plan.md:56` writes **"`@kitchensink/ai-service` (ALB priority
400)"** — a per-service constant, which is the exact thing `CLAUDE.md` marks with ⛔ and which the
allocator's docstring (`listener-priority.ts:6-9`) records as having already caused a live deploy
collision once.

**Verdict**: **SURVIVES.** The stated ceiling is escapable and the real one is not, and the accepted
roster consumes 90 % of the real one.

**What must change**:

1. Correct the `CLAUDE.md` sentence and ADR-0003 to name **target groups per ALB (100, not
   adjustable)** as the binding quota, with the concurrent-PR arithmetic above.
2. Add a synth-time assertion in `packages/infra/alb` that the roster × expected-concurrent-PRs
   product stays under 100, so this fails where every other ALB failure in this repo fails — loudly,
   at synth.
3. Delete "(ALB priority 400)" from `specs/005-ai-integration/plan.md:56`.

---

## A-3 — Extracting 006 before implementation draws a service boundary with zero access-pattern information

**Claim attacked**: ADR-0017 Amendment reason 2 (0017:248-251) — "The extraction cost this ADR
quantified is lowest before implementation, not after… Paying it now is strictly cheaper than paying
it after 006 ships inside `@kitchensink/schema-recipe`."

**Attack**: this conflates two different costs and only prices one. _Migration_ cost (data to move,
consumers pinned to a shared contract) is indeed lowest at zero implementation — that part is true.
_Design_ cost is the opposite: a service boundary is a guess about which operations must be
transactional and which may be eventually consistent, and the only thing that validates that guess
is a measured access pattern. 006 has none. So the amendment optimises the cheap axis and pays full
price on the expensive one — and ADR-0017 itself wrote the flip condition as a **measured** one
("write volume or a scaling profile that competes with recipe search", 0017:140) precisely because
its author understood that.

**But the more concrete failure is that the quoted cost is simply wrong for 006.** ADR-0017:144-145
says "the cost of the extraction is a new schema package plus a client base-URL change", and the
amendment repeats it as still true. 006's own plan already contradicts it:

- `specs/006-meal-planning/plan.md:141` — a `recipe.gateway.ts`, "the ONLY door to the recipe
  service", which does not exist in either service today.
- `plan.md:536-537` — the gateway requires an **additive batch nutrition projection on
  recipe-service** that has not been built, tracked as T001–T003.
- `plan.md:46` — "nutrition read MUST NOT be N+1 (requires the additive recipe-service batch
  projection below)"; `plan.md:614` — chunking to a batch limit and merging is the gateway's
  concern.
- `plan.md:374` — a **`503` when the recipe gateway is unavailable**, i.e. a new user-visible
  failure mode that does not exist for a module call.
- `plan.md:609` — degraded rendering "so a recipe-service blip degrades the planner instead of
  500-ing it".
- `plan.md:686` — a **k6 "gateway-degraded profile"**, a whole load-test tier that exists only
  because of the boundary.
- `plan.md:684` — integration tests "against a stubbed HTTP server incl. timeout/5xx/malformed".

None of that is "a schema package plus a base-URL change". It is a new HTTP contract, a batch
endpoint on the _other_ service, chunking, a circuit-degraded path, a new 503, a new k6 profile and
a new test double tier. **The amendment quotes a cost figure that 006's own plan already refutes.**

**Verdict**: **SURVIVES on the reasoning; the decision itself is WEAKENED, not refuted** — see A-5,
where a genuinely sound rationale for the same decision exists and was not used.

**What must change**: the amendment must replace the "schema package plus base-URL change" figure
with 006's actual extraction inventory (the seven items above), and must cite C-006-001's rationale
rather than the two it wrote. A decision defended by a cost figure its own feature plan contradicts
is not defensible, even when the decision is right.

---

## A-4 — The amendment says "007, 009 and 010 are unchanged". For 007 and 009 that is false

**Claim attacked**: ADR-0017 Amendment (0017:230) — "007, 009 and 010 are **unchanged** and remain
in the services named there."

**Attack**: 007 and 009 were placed in the recipe service _because of their joins to 006_
(ADR-0017:85-95: "`meal_plan_entries.recipe_id`… grocery-list generation reading a plan's entries…
009's `meal_plan_nutrition_link` is a join table between a 006 table and a 009 table"). Moving 006
to its own database moves the network boundary into the middle of both. The amendment does not
withdraw those three bullets, does not re-argue 007's and 009's placement, and does not repoint the
two plans that declare hard foreign keys into `meal_plans`.

**Evidence**:

- `specs/007-grocery-lists/plan.md:49` — `meal_plan_id UUID REFERENCES meal_plans(id), -- nullable,
can be standalone`.
- `specs/007-grocery-lists/plan.md:479` — "If the meal plan is deleted, `meal_plan_id` is set to
  NULL via **`ON DELETE SET NULL`**". Under the amendment this is a cross-database referential
  action. It cannot exist. There is no replacement mechanism specified — no event, no reconcile
  sweep, no tombstone — so "the list shows 'Meal plan no longer available'" now has no trigger.
- `specs/007-grocery-lists/plan.md:415` — an index on a column whose FK is gone.
- `specs/007-grocery-lists/plan.md:489` — generation "respects the serving multiplier stored on each
  `meal_plan_recipe` row (from feature 006)" — a read of another service's row, now an HTTP call
  with no contract, no timeout budget and no degraded path specified.
- `specs/007-grocery-lists/tasks.md:98` — "Depends on: 006-meal-planning migration (**meal_plans
  table must exist**)" — in what is now a different database, so this dependency is unsatisfiable
  as written.
- `specs/007-grocery-lists/tasks.md:427` — the ADR-0017 repointing table's own stated reason:
  "**one database, so `meal_plan_entries → recipes` stays a foreign key instead of a network hop**".
  That reason is now false and the table was not updated.
- `specs/009-nutrition-planning/tasks.md:56-58` — "**Depends on**: 006-meal-planning schema";
  `meal_plan_nutrition_link` created in 009's migration. A join table cannot span two databases.
- `specs/009-nutrition-planning/v-model/module-design.md:359,910` — `MealPlanningAdapter
.mealPlanExists(...)` and `.fetchMealPlanTotals(...)`, which were in-process calls under
  ADR-0017's decision 4 and are now unspecified HTTP edges on the compliance-calculation path that
  ADR-0017:94-95 warned must not have a transaction boundary through it.

006 itself already solved this for its own side — `specs/006-meal-planning/spec.md:44-48`
(C-006-002) forbids cross-database FKs and stores `recipe_id` as a bare `uuid`. **007 and 009 never
received the equivalent ruling**, so the tree now holds two plans declaring FKs into a table that
lives in another database.

**Verdict**: **SURVIVES.** The amendment breaks two other features' data models and says it changes
nothing.

**What must change**: before any of 006/007/009 is implemented —

1. Amend `specs/007/plan.md:49,415,479,489` and `tasks.md:98,427` to C-006-002's rule: `meal_plan_id`
   is an unenforced `uuid`, and the "no longer available" state is a **read-time gateway miss**, not
   `ON DELETE SET NULL`.
2. Amend 009 to make `meal_plan_nutrition_link` local to 009 with an unenforced `meal_plan_id`, and
   specify `MealPlanningAdapter` as an HTTP gateway with a timeout budget, a degraded path and a
   `503`, mirroring 006's own `recipe.gateway.ts`.
3. Re-argue 007's and 009's placement explicitly. With 006 gone, "the joins are all against recipes"
   is only half true for them, and the amendment owes that paragraph.

---

## A-5 — The amendment's premise is circular, and it ignored the better argument sitting in 006's own spec

**Claim attacked**: ADR-0017 Amendment reason 1 (0017:243-247) — "The recipe service's scope grew
after this ADR was written. ADR-0019 places the bulk import processor, four channel adapters,
ingredient resolution and per-entity status emission in the recipe service… 'one more module' is a
materially different proposition against the larger one."

**Attack**: both ADRs are dated **2026-08-14** and both were authored in the same sitting. So the
argument is: _we enlarged recipe-service two documents ago, therefore we must now evict a different,
unrelated feature from it._ That is a justification the author manufactured and then cited. If
recipe-service's scope is the problem, the thing to relitigate is ADR-0019's placement of the import
spine — not 006, which was never the growth.

Worse, ADR-0019 **continues** to grow recipe-service in the same breath: §5 (0019:118-127) puts the
placeholder projection there, §4 puts per-entity status emission and an outbox/publish path there
(0019:161-164), and §1 puts four channel adapters plus ingredient resolution there. Evicting 006
does not offset any of it — 006 is not on the import path.

**And there is a real argument that neither document used.**
`specs/006-meal-planning/spec.md:38-42` (**C-006-001**, recorded 2026-08-02, twelve days _before_
ADR-0017 decided the opposite) states it plainly: `kitchensink_recipes` "is already operated on by
**three scheduled destructive workers** (version-archive prune, GDPR erasure sweep, orphan deletion)
whose blast radius must not widen." `specs/006/plan.md:720` repeats it and prices it honestly ("for
a saving of ~$8/mo/stage").

That is an engineering rationale — a blast-radius argument about destructive background jobs, which
is exactly the kind of thing that legitimately justifies a boundary. **ADR-0017's "Alternatives
rejected" never mentions those three workers**, and neither does the amendment. So the original
decision was made without reading the feature's own recorded constraint, and the reversal was made
without finding it either.

Byproduct: `specs/006/plan.md:384` still says "✅ **RESOLVED (2026-08-12) — `/api/v1/meal-plans/*` is
owned by `@kitchensink/recipe-service`**" while `plan.md:720` argues for `@kitchensink/meal-plan-service`.
006's plan currently contradicts itself.

**Verdict**: **SURVIVES on the reasoning. The decision is REFUTED as an attack target** — extracting
006 is defensible, just not for either reason given.

**What must change**: rewrite the amendment's "Why, stated honestly" to cite C-006-001 and the three
destructive sweepers, and delete reason 1 (the circular one) entirely. Reconcile
`specs/006/plan.md:384` with `:720`.

---

## A-6 — The image service is the wrong compute shape, and 011's own plan already specified the right one

**Claim attacked**: ADR-0019 §3 (0019:78-82) — a dedicated always-on, ALB-fronted
image-processing **service**, justified because "the workload is CPU/GPU-shaped and bursty rather
than request-shaped, it carries a vendor dependency the recipe service should not link, and it
scales on a different axis from recipe CRUD."

**Attack**: every one of those three grounds argues for **serverless**, and the ADR reads them as
arguing for an ECS service. "Bursty rather than request-shaped" is the canonical case _against_ a
service with a `desiredCount` you pay for at idle and _for_ a queue-driven worker that scales to
zero. ADR-0019 §"Accepted costs" (0019:157-159) confirms the shape chosen is ALB-fronted: it draws
"an ALB listener-rule priority from the single allocator". An ALB rule means a target group means a
long-lived ECS task means 24/7 billing per stage **and per open PR** — and per ADR-0010 residual 1
(`0010:156-160`), per-PR ECS is **not** in the sandbox nightly-shutdown selector, so a preview's
image service burns 24 h/day to serve an OCR request nobody makes.

**Evidence that the repo already chose the right shape and ADR-0019 overrode it without saying so**:

- `specs/011-recipe-digitization/plan.md:12` — the planned infrastructure is "**Lambda + SQS/DLQ +
  S3 + CloudFront** + RDS-backed APIs".
- `plan.md:22,127,385-388` — `@kitchensink/digitization-workers`, "**SQS-triggered worker, batched
  receive with partial failure reporting**", calling the Textract adapter with a timeout budget.
- `plan.md:153` — "Job enqueued to SQS (`digitization-ocr` queue), Lambda worker processes OCR".
- `plan.md:94` — S3 + presigned URLs (`@aws-sdk/s3-request-presigner`) are already the upload path,
  so the image bytes never need to traverse an HTTP service at all.
- `plan.md:431-432` — SQS redrive/backoff and a circuit breaker, i.e. the resilience design is
  already queue-shaped.

The repo also already operates five Lambda handlers with a working VPC/no-VPC discipline
(`identity-webhooks`: webhook, deletion-worker, reconciliation, migrate, log forwarder; ADR-0004),
so this is the _established_ pattern, not a new one.

**The premise is also weaker than stated.** With AWS Textract the heavy lifting runs at the vendor;
our side is presign → S3 → SQS → fetch → `sharp` preprocess → call Textract → normalise. That is
I/O-bound orchestration plus a bounded per-image CPU step. `sharp` runs on Lambda arm64; Lambda
gives 10 GB / 6 vCPU / 15 min per invocation with per-ms billing and true scale-to-zero. There is no
GPU anywhere in 011's plan — `grep -n GPU specs/011-recipe-digitization/plan.md` returns nothing.
"CPU/GPU-shaped" is asserted, not evidenced.

**Cost of the wrong shape**, at ADR-0010's own measured Spot rate for a 0.5 vCPU / 1 GB task
(`0010:118-124`, ≈ $5.50/mo): ≈ $5.50/mo × (prod + sandbox + every open PR), 24/7, plus one of the
eight scarce ALB slots (A-2), plus a target group, plus a deploy job, smoke test and CDK stack —
to serve a workload whose Lambda bill at this traffic rounds to zero.

**Verdict**: **SURVIVES.** ADR-0019 chose an always-on compute shape for an admittedly bursty
workload, against the shape 011's own plan already specified, and did not record that it was
overriding it.

**What must change**: replace ADR-0019 §3's "dedicated image-processing service" with **the
digitization worker 011 already specifies**: presigned S3 PUT → S3 event → SQS → Lambda → submit
candidates to the recipe service's bulk import processor. This keeps every one of the ADR's three
stated grounds satisfied (vendor dependency isolated in its own package, independent scaling axis,
burst absorption by the queue), costs **zero** ALB slots, **zero** target groups, and **$0 at idle**
per stage and per PR. If ADR-0019 wants to keep an HTTP surface for it, that surface is API Gateway

- Lambda, which is also what `identity-webhooks` already does.

---

## A-7 — "It holds no persistent state" is incompatible with what 011 actually requires

**Claim attacked**: ADR-0019 §3 (0019:84-87) — "**It holds no persistent state.** Images in flight
live in object storage; the durable record of the import is the recipe service's, exactly as for a
URL import."

**Attack**: an image import is not "exactly as for a URL import". 011 requires durable, queryable,
per-job state that no URL import has, and the ADR names no home for any of it.

**Evidence**:

- `specs/011/plan.md:196,443` — `raw_ocr_json` is retained and "auto-null/purge at **90d** (FR-036,
  NFR-008, C-005)". A 90-day retention-and-purge obligation is by definition persistent state with
  a scheduled job attached.
- `plan.md:79` — **token-level confidence** must be captured when the provider supplies it, and
  `overallConfidence` falls back to a document score. The correction UI (011's stated
  differentiator, `plan.md:20`) renders that per-token confidence; it cannot be reconstructed from
  the image.
- `plan.md:520` — "OCR & Parsing FR-006..FR-013 | OCR Lambda + **job state machine + polling
  APIs**". A job state machine with polling APIs is state plus a query surface.
- `plan.md:127` — the package layout already carries `digitization_jobs` state in RDS
  (`plan.md:94`: "**Storage**: RDS PostgreSQL 16").
- `plan.md:296-310` — OCR output is explicitly "untrusted, attacker-influenceable content" that
  must be parsed at the boundary. Wherever it is stored, that store inherits a security obligation.

So the state has exactly two possible homes and both are bad:

1. **The recipe service.** Then recipe-service acquires OCR job rows, `raw_ocr_json`, per-token
   confidence, and a **fourth** scheduled destructive worker (the 90-day purge) — inside the
   database whose _three existing_ destructive sweepers were just used as the rationale for evicting
   006 (A-5). The topology would then evict meal planning from recipe-service to protect it from
   destructive jobs, and immediately add another one.
2. **Nowhere.** Then 011's correction UX — the thing 011 exists for (`plan.md:20`) — cannot be
   built, and the 90-day purge requirement has no subject.

The ADR resolves this by not mentioning it.

**Verdict**: **SURVIVES.** "Owns no database" and 011's FR-036 / NFR-008 / correction UX cannot both
be true.

**What must change**: ADR-0019 §3 must name the owner of `digitization_jobs`, `raw_ocr_json`,
per-token confidence, and the 90-day purge job. The consistent answer, given A-6, is
`digitization-workers` + a small digitization schema in its **own logical database** on the shared
RDS (ADR-0006 already makes a logical DB free), with the _recipe_ remaining the recipe service's —
which preserves the ADR's actual invariant ("the recipe result lives in one database") without the
false claim that the branch is stateless.

---

## A-8 — The user-visible value of FR-048/049 cannot ship, and the degraded path is asserted rather than specified

**Claim attacked**: ADR-0019 §4 (0019:112-113) — "Feature 014 owns the service that consumes these
messages and pushes them to clients. 004 and 011 own **emitting** them and the destination's
existence; they do not own delivery." And §5's claim that the DB projection makes this safe.

**Attack**: 004 FR-048 and FR-049 (`specs/004/spec.md:217-230`) are requirements written entirely in
terms of emission. The user-visible outcome they exist for — "the user can see their 1,000-recipe
import progressing" — is delivered by feature 014, which per ADR-0016:319-320 has **no service, no
schema package and no client**: "`packages/services/notification-service`,
`packages/schemas/notifications` and `packages/clients/notifications` are all unbuilt; 014 is a
spec." Verified: none of those three directories exists.

So on the day 004 ships, the import spine emits superseding, monotonically sequenced status messages
into a bus that no consumer reads, and the user sees nothing move.

**The degraded path is where the honesty gap is.** ADR-0019 §5 says the DB projection is the
fallback and is "precisely why §5 is not optional" (0019:161-164). But a projection is only a
fallback if a client can _read_ it, and:

- `grep -n "GET /api" specs/004-recipe-importing/plan.md` returns **no import-status endpoint**.
  The plan lists no `GET /api/v1/imports/{id}` and no bulk-import route at all; its only endpoint
  discussion is `POST /api/v1/recipes` provenance (`plan.md:239-242`).
- 004's plan predates the 2026-08-14 spine ruling entirely — FR-046..FR-051 were added to
  `spec.md` and the plan was never repointed. `plan.md:185` mentions "import-job, draft and error
  wire types **and zod**" and nothing else.
- ADR-0019 §5 requires the **food** database to hold shell entries carrying processing status
  (0019:120-127), i.e. the fallback read for ingredient status is a _cross-service_ read against
  food, on the same forwarded-user-token path attacked in A-9.

So the degraded path is: poll an endpoint that no document specifies, against a projection split
across two services' databases, one of which requires a credential that does not exist for
background work.

**Verdict**: **SURVIVES.** The spine's user-visible value is gated on an unbuilt service, and the
stated fallback has no specified read surface.

**What must change**:

1. 004's plan must specify the **fallback read surface** — `GET /api/v1/imports/{importId}` returning
   the per-recipe and per-food projection — and 004's acceptance criteria must be satisfiable with
   014 absent. Polling an endpoint is an honest v1; "emit into a void" is not.
2. ADR-0019 §4 must state plainly that **004 ships with polling and 014 upgrades it to push**, and
   that the message bus is built but unconsumed until 014 lands. That sentence is currently missing
   and it is the one a reader needs.
3. If 014 is genuinely a prerequisite for FR-048/049's value, say so in 004's dependency table
   (`spec.md:30` lists 010 as Required and does not list 014 at all).

---

## A-9 — ADR-0019 adds cross-service edges that cannot be authenticated with anything this system has

**Claim attacked**: ADR-0019 §3 — the image service "submits the resulting candidate recipes to the
same bulk import processor as every other channel" — and §1's bulk processor performing "ingredient
resolution" asynchronously behind `queued`/`processing` states.

**Attack**: both are machine-to-machine calls. This system has no machine-to-machine credential, and
the only credential it has expires in roughly sixty seconds. ADR-0019 does not mention
authentication once.

**Evidence** — `packages/services/recipe-service/src/ingredients/food-service-clients.factory.ts:6-13`,
verbatim:

> "food's `FoodAuthGuard` verifies a _Clerk_ token, so the only credential that can satisfy it is the
> caller's own (short-lived, per request). The previous wiring built two long-lived singleton clients
> around a static `FOOD_SERVICE_TOKEN` env string — **a value that was never set anywhere and could
> not have worked if it had been, since a Clerk session token expires in ~60s**."

And `:68-71`: "or `undefined` (no bearer…) in which case the client sends no `Authorization` and
food will fail it closed. **There is deliberately no fallback credential.**"

Consequences ADR-0019 does not address:

1. **Async ingredient resolution has no credential.** The spine's whole point is that import is
   long-running (`queued` → `processing`, a 1,000-recipe file, ADR-0019 §4). Any resolution that
   outlives the request — which is the design — runs in `recipe-workers` with no user token, so
   `resolve`/`addByName` against food will fail closed. The `succeeded`/`failed` distinction becomes
   "the user's token expired", which is neither.
2. **The image service cannot call the bulk processor.** It has no user session. Its input arrives
   as an upload; its output is submitted minutes later.
3. **§5's shell entries are unreachable.** The shell is "created and advanced by the food service's
   own resolution pipeline **because a recipe referenced an ingredient it had not yet resolved**"
   (0019:129-134). That trigger is a recipe→food call from a background context. Same wall.
4. A partial answer exists and ADR-0019 does not cite it: `specs/005-ai-integration/plan.md:370`
   mints a **Clerk actor token** (`actor.sub` = a machine identity) per ADR-0012. That mechanism is
   scoped to `ai-service`'s task role only (`plan.md:529`) and is not general.

This is a **security gate**, not a nit: the alternative a hurried implementer will reach for is
exactly the one the repo already deleted twice — a static shared secret in an env var (the dead
`FOOD_SERVICE_TOKEN`), or a trusted header (`x-authorizer-context`, removed in PR #39 as forgeable
behind a public ALB, per `CLAUDE.md` §Authentication).

**Verdict**: **SURVIVES.** ADR-0019 designs three new machine-to-machine edges onto a system whose
own code says it has no machine-to-machine credential and deliberately no fallback.

**What must change**: **before** any spine code is written, an ADR must decide the service-to-service
credential once, for the whole portfolio — the plausible options being (a) generalise ADR-0012's
Clerk actor-token mint into a shared `@kitchensink/service-auth`, or (b) an internal listener path
with SigV4/IAM auth so machine traffic never rides the public rule at all. Whichever is chosen, it
must be named in ADR-0019 §1 and §3, and the "no fallback credential" invariant at
`food-service-clients.factory.ts:68-71` must be preserved explicitly rather than quietly widened.

---

## A-10 — The per-PR ephemeral model multiplies every service, and every ADR prices it as if it were additive

**Claim attacked**: ADR-0017 Amendment (0017:253-257) and ADR-0019 (0019:157-159) — each new
deployable costs "one more task per open pull request (≈ $8.25/month each, ADR-0010)".

**Attack**: $8.25 is quoted as a per-service constant. It is not a constant, it is a **coefficient
on the number of concurrently open PRs**, and it is quoted from a measurement of a service that
happens to run _two_ tasks (`0010:118-124`: food API $5.50 + food worker $2.75). More importantly,
nobody has summed it.

**Evidence and arithmetic** (all at ADR-0010's own Spot figures; task sizes read from
`recipe-service-stack.ts:317-318` and `food-service-stack.ts:369-370,434-435`: API = 0.5 vCPU / 1 GB,
worker = 0.25 vCPU / 0.5 GB):

**Per open PR** — 9 of the 10 deployables get a preview (identity does not,
`listener-priority.ts:99-101`), each 1 API task (`FOOD_DESIRED_COUNT=1`, `0010:127-129`), plus the
worker packages:

|                       | today (3 services) | accepted roster (10) |
| --------------------- | ------------------ | -------------------- |
| API tasks             | 2                  | 9                    |
| worker tasks          | 1                  | ~5                   |
| **per open PR, 24/7** | **≈ $13.75/mo**    | **≈ $63.25/mo**      |

That is a **4.6× multiplier on every open PR**, and per ADR-0010 residual 1 (`0010:156-160`) none of
it is in the nightly-shutdown selector, so all of it bills 24 h/day while the sandbox RDS it talks
to is stopped 00:00–09:00 ET.

**Prod is worse and nobody has priced it at all.** Prod runs **on-demand**, not Spot, at the stack
default `desiredCount: 2` (`0010:127-129` — "Prod deploys from `prod-deploy.yml` and keeps the
two-task default"). At published us-east-1 Fargate on-demand rates ($0.04048/vCPU-h +
$0.004445/GB-h), a 0.5 vCPU / 1 GB task is ≈ $18.02/mo, so:

> **10 API services × 2 tasks × $18.02 ≈ $360/month in prod Fargate compute alone** — before RDS,
> ALB, NAT, ElastiCache, S3, CloudFront, workers, or a single open PR.

The account budget is **$300/month** (ADR-0008, `kitchensink-cost-guardrails`). **The accepted
service roster exceeds the entire account budget with its production compute line item.** Add
sandbox (10 × ~$5.50 Spot ≈ $55) and three concurrent PRs (3 × $63.25 ≈ $190) and the figure is
roughly **$600/month against a $300 budget** — on a repo that runs a `t4g.nano` NAT instance to save
$28/month (ADR-0004) and moved sandbox RDS to gp3 to save single-digit dollars (ADR-0008).

ADR-0016:295-298 got this exactly right for a _cache_ — it rejected one-cache-per-PR at $6.13/mo
because "every open PR would add ≈ $6.13/mo… on top of the ≈ $8.25/mo food API task ADR-0010 already
accepts". The identical reasoning applied to a _service_ would have rejected most of this roster.
The precedent exists; it just was not applied to compute.

**Verdict**: **SURVIVES.** The per-PR and per-stage cost of the accepted roster is not underweighted
by a little; it is roughly 2× the account budget, and no document in the tree contains the sum.

**What must change**: the roster ADR demanded in A-1 must carry the three-line arithmetic above
(prod on-demand, sandbox Spot, per-PR Spot × concurrent PRs) and must be re-run before **any**
deployable is added. Two levers are already identified and unclaimed: widen `isSandboxClusterArn` to
match `pr-{N}` clusters (`0010:156-160`, "~37% off every preview's compute bill and cost nothing in
functionality"), and set prod `desiredCount: 1` for services with no availability SLO.

---

## Cheapest topology that meets the requirement

Same user-visible outcomes: method chooser → one bulk import pipeline → photo/OCR with a correction
UI → live import status → meal plans, grocery lists, nutrition, circles, creator profiles, cooking
school, notifications.

**Five ALB-fronted deployables, not ten:**

| #   | Deployable          | Holds                                                                                           | Why it earns a slot                                                                                                                             |
| --- | ------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `identity-service`  | auth, accounts, 010 billing                                                                     | shipped; ADR-0017's 010 reasoning stands                                                                                                        |
| 2   | `food-service`      | ingredients, USDA pipeline, §5 shells                                                           | shipped; single-writer discipline                                                                                                               |
| 3   | `recipe-service`    | recipes, search, 004 import spine, **007**, **009**, **011 Circles/audience**, **012**, **013** | every one of these has `recipes` as its most-referenced FK                                                                                      |
| 4   | `meal-plan-service` | 006                                                                                             | **C-006-001**: three scheduled destructive sweepers in `kitchensink_recipes` whose blast radius must not widen — a real, non-speculative reason |
| 5   | `ai-service`        | 005                                                                                             | ADR-0012 gives it Clerk-actor-token _minting_; that is a genuine security boundary, not packaging taste                                         |

**Everything else is serverless, and each is the shape its own spec already chose:**

- **011 image branch** → presigned S3 PUT → S3 event → SQS → `digitization-workers` Lambda →
  recipe bulk processor. Exactly `specs/011/plan.md:12,153,385-388`. Its job state and
  `raw_ocr_json` live in its own logical DB on the shared RDS (free under ADR-0006), with the
  90-day purge as an EventBridge-scheduled Lambda (`plan.md:484` already has one).
- **014 notification delivery** → **API Gateway WebSocket + Lambda**, over the ADR-0016 Valkey cache
  (which is already per-stage and already $0 per PR). This preserves every decision in ADR-0016 —
  72-hour retention, two dedup indexes, the Lua publish-accept, user-scoped ack — while deleting an
  always-on Fargate service and its ALB slot. 014 is unbuilt, so the rewrite cost today is zero.
- **007 retailer polling, 009 nightly rollup, 012 analytics snapshots, 013 transcode callbacks** →
  `recipe-workers` / EventBridge Scheduler, as ADR-0017 decision 5 already directs.
- **010 Stripe webhook** → `identity-webhooks`, unchanged.

**What this buys**: 5 ALB rules + 5 target groups at base; 4 per open PR (identity has no preview)
→ concurrent-PR ceiling ≈ **(100−5)/4 ≈ 23** instead of 10. Per open PR ≈ **$22–28/mo** instead of
≈ $63. Prod Fargate ≈ **$180/mo** at `desiredCount: 2`, ≈ **$90** at 1 — inside the $300 budget with
room for RDS, ALB, NAT and CloudFront. Three of the eight ALB slots stay unclaimed, which is what
`listener-priority.ts:100-101` says they are for.

**What it gives up, stated rather than hidden:**

1. **Blast radius.** A recipe-service incident takes down imports, grocery lists, nutrition, circles,
   creator profiles and cooking school. Acceptable at this scale and this traffic; it is the same
   trade ADR-0017:204-206 already accepted, extended to three more features.
2. **Independent deploy cadence** for 012 and 013. One deploy job, one image, one rollback. For a
   one-owner team this is a _benefit_ disguised as a cost, but it is a real loss if 013's video
   pipeline ever needs its own release train — and that is its flip condition.
3. **009's GDPR Article 9 data stays co-located.** ADR-0017:138 already records physical isolation
   as 009's flip condition; unchanged here.
4. **014 becomes Lambda handlers, not NestJS.** Its plan's controller/module shape is rewritten. Zero
   migration cost today (nothing is built), non-zero re-planning cost.
5. **A WebSocket connection cap.** API Gateway WebSocket has its own quotas and a 2-hour max
   connection duration; clients must reconnect. 014 already requires reconnect-and-replay
   (ADR-0016 decision 5), so this costs nothing new.
6. **`recipe-service`'s name understates it even further.** ADR-0017:126-130 already accepted this
   and forbade a rename. It gets worse. It is still not worth a service.

**Non-negotiable precondition for any topology, including this one**: the service-to-service
credential from A-9 must be decided before the first cross-service edge is built.

---

## Where the design held

Attacks I ran that failed against the evidence, stated plainly:

1. **"The 006 extraction is unjustified."** **REFUTED.** `specs/006/spec.md:38-42` (C-006-001)
   carries a sound blast-radius rationale — three scheduled destructive workers in
   `kitchensink_recipes` — that predates ADR-0017 by ten days. The decision is right; only the
   amendment's stated reasoning is wrong (A-5).
2. **"The amendment dressed an owner preference up as evidence."** **REFUTED.** ADR-0017:236-239
   says the opposite, unprompted: "it has **not** been measured… This amendment is therefore an
   **owner architectural decision**, not the firing of the recorded trigger, and it is recorded as
   such rather than dressed up as evidence." That is exemplary and should be the house style.
3. **"Superseding status messages will lose updates."** **REFUTED.** ADR-0019:105-110 already
   requires supersession by a monotonic sequence in the envelope and explicitly rejects arrival
   order, naming the exact failure ("silently reverts `succeeded` to `processing` on a redelivery").
   Correct and non-obvious.
4. **"Status-in-messages-only will strand clients."** **REFUTED as an attack on the ADR** —
   ADR-0019 §5 already requires the durable projection and states the invariant ("a status message
   is a notification _of_ a committed state change, never the state itself"). The gap is that no
   _read surface_ for that projection is specified anywhere (A-8), which is a spec gap, not a design
   error.
5. **"One bulk processor is over-abstraction."** **REFUTED.** ADR-0019 §1 deletes four divergent
   copies of the post-parse tail and makes a new channel an adapter plus a union member. This is the
   one part of the spine that unambiguously removes work.
6. **"The shell-entry design smuggles recipes into the food database."** **REFUTED.** ADR-0019:129-134
   holds the line explicitly and correctly: a shell is a _food_ in a pending state, created by
   food's own pipeline, one writer, relationship still one-directional.
7. **"The ALB allocator is over-engineered."** **REFUTED.** `listener-priority.ts:28-36`'s
   bands-not-stride reasoning and the `assertWithinAlbRange` guard are exactly right, and the
   `EPHEMERAL_SLOT_ORDER.length <= EPHEMERAL_SERVICE_SLOTS` assertion at
   `__tests__/listener-priority.test.ts:80` is what will catch the 9th service **at build**, in CI,
   rather than mid-deploy. The module is doing its job; the portfolio is what outgrew it.
8. **"ADR-0016 was profligate."** **REFUTED, and it is the precedent the rest of the topology should
   copy.** ADR-0016:291-298 rejected one-cache-per-PR on exactly the arithmetic A-10 says is missing
   for compute, and it priced six alternatives with reproducible sums. That is the standard.
9. **"014's cost residuals are hidden."** **REFUTED.** `specs/014/plan.md:534-541` records the
   nightly-shutdown exclusion itself and names the levers. Known, not free — as it says.
