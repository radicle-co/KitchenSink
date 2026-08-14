# 0017 — Features 006, 007 and 009 land in the recipe service; 010 lands in the identity service. No new deployable is created

- **Status**: Accepted
- **Date**: 2026-08-12
- **Drivers**: [GR-015](../../../specs/governance-rules.md) Current State recorded, for two months, that
  _"Features 006–010 do not identify an owning service package for their endpoints at all"_, and
  [GR-016](../../../specs/governance-rules.md) inherited the same hole. Four plan documents carried a 🟠
  **OPEN** marker asking the owner to pick a service. **This ADR closes all four.**
- **Relates to**: [ADR-0014](0014-service-owned-api-contracts.md) — the schema package is **per SERVICE**,
  not per feature, so this decision also decides which schema package each feature extends;
  [ADR-0003](0003-shared-alb-per-stage.md) — a new service costs an ALB listener-rule priority;
  [ADR-0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md),
  [ADR-0007](0007-sandbox-cost-controls.md), [ADR-0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md),
  [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md) — a deployable service is a recurring bill per stage
  **and per open PR**, which is the constraint this decision is actually optimising against.

## Context

Four features specify HTTP surfaces with no owning service package:

| Feature                | Paths                                                     | What its `tasks.md` had already assumed                                 |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| 006 Meal Planning      | `/v1/meal-plans/*` (**bare prefix — a GR-002 violation**) | `packages/api/src/meal-plans/…` **and** `packages/services/nutrition/…` |
| 007 Grocery Lists      | `/api/v1/grocery-lists/*`                                 | `packages/services/grocery-service/…` (30+ file paths)                  |
| 009 Nutrition Planning | `/api/v1/nutrition-plans/*`, `/api/v1/trainer/*`          | `packages/services/nutrition-service/…`                                 |
| 010 Subscriptions      | `/api/v1/billing/*`                                       | the identity service (implied by its module tree and its build step)    |

So the task files had already invented **four different answers across three features**, two of them naming
a "nutrition" package under two different names, and one naming a `packages/api/` group that does not exist
in this monorepo. None of them was ratified anywhere. That is the cost of leaving the question open: it does
not stay open, it gets answered incompatibly in the lowest-authority document.

The decision matters beyond tidiness because ADR-0014 makes the owning service the **author of the wire
contract**, and the schema package name follows from it. Until this was settled, none of these features could
name the package its clients must import, which is precisely the hole GR-015 §15-b exists to close.

**The constraint that actually exists.** This repository runs a $300/month account budget
([ADR-0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md)), a `t4g.nano` NAT instance
instead of a NAT Gateway ([ADR-0004](0004-minimize-nat-egress.md)), one shared ALB per stage
([ADR-0003](0003-shared-alb-per-stage.md)), and a nightly sandbox shutdown
([ADR-0007](0007-sandbox-cost-controls.md)). A new deployable HTTP service is not a free architectural
choice here: it is an ECS service per stage plus **one more task per open pull request** — ADR-0010 measures
food's single per-PR API task at **≈ $8.25/month per open PR** — plus an ALB listener-rule priority, a
logical database, a Dockerfile, a deploy job, a smoke test, a schema package, a client package, and a
`CONTRACT_HASH` boot assertion. Three new services would have multiplied all of that by three, for features
that have **no implementation at all** yet.

## Decision

**No new deployable service is created for 006, 007, 009 or 010.**

| Feature | Owning service                                                                  | Schema package (ADR-0014)      | Consuming client                                   |
| ------- | ------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------- |
| **006** | `@kitchensink/recipe-service`                                                   | `@kitchensink/schema-recipe`   | `@kitchensink/recipe-service-client`               |
| **007** | `@kitchensink/recipe-service`                                                   | `@kitchensink/schema-recipe`   | `@kitchensink/recipe-service-client`               |
| **009** | `@kitchensink/recipe-service`                                                   | `@kitchensink/schema-recipe`   | `@kitchensink/recipe-service-client`               |
| **010** | `@kitchensink/identity-service` (+ webhook in `@kitchensink/identity-webhooks`) | `@kitchensink/schema-identity` | the identity consumer named by 002's own OPEN item |

Consequences that follow immediately and are not separate decisions:

1. **006's paths move to `/api/v1/meal-plans/*`.** The bare `/v1/*` form is a GR-002 violation that 006's own
   plan already flags as the portfolio's last holdout; adopting recipe-service means adopting its prefix.
2. **A feature does not get a schema package — a SERVICE does.** 004 already established this pattern for the
   recipe service ("adds to `packages/schemas/recipe`, never forks it"). 006, 007 and 009 add `*.schema.ts`
   files to `packages/services/recipe-service/src/{meal-plans,grocery-lists,nutrition-plans}/`, and the
   existing generator copies them into the existing `@kitchensink/schema-recipe`. There is no
   `@kitchensink/schema-meal-planning`, `-grocery`, `-nutrition` or `-billing`.
3. **`@RequirePremium()` / `PlanGuard` (010) live wherever the entitlement is read**, which is every gated
   service — so the guard is a **shared** concern (`packages/shared/*`) reading a claim from the Clerk session
   token, not an import from the identity service. An app or service importing
   `@kitchensink/identity-service` to gate a route would violate the boundary
   `packages/infra/global/__tests__/app-service-dependency.test.ts` already enforces.
4. **Existing NestJS modules are the internal boundary.** `MealPlansModule`, `GroceryListsModule`,
   `NutritionPlansModule` are siblings of `RecipesModule`/`SearchModule`, each with its own DAL and its own
   `*.schema.ts` beside its controller. This is a modular monolith on purpose; the module edges are where a
   future extraction would cut.
5. **The retailer adapters (007) and the compliance rollup (009) run in `@kitchensink/recipe-workers`**, not
   in the API process. 007 already chose polling over webhooks for order status, and 009's rollup is a nightly
   job — both are asynchronous by design, and the existing worker package is where asynchronous work already
   lives.

### Why the recipe service for 006, 007 and 009

- **The joins are real and they are all against recipes.** `meal_plan_entries.recipe_id`,
  the nutrition rollup over a plan's recipes, and grocery-list generation reading a plan's entries plus each
  recipe's ingredients are the three hottest queries these features have. In one database they are joins with
  referential integrity. Across services they are N round trips with no consistency story.
- **It deletes work rather than adding it.** 006 currently specifies a recipe-deletion orphan handler
  (TASK-018) and an `is_orphaned` column — both of which exist **only** because someone assumed a separate
  database and therefore no foreign key. In the recipe service, `ON DELETE CASCADE` does that job and the task
  and the column both disappear. A design that removes a task, a column and a background job is the simpler
  design, not merely the cheaper one.
- **006 ↔ 009 are two halves of one question.** 009's `meal_plan_nutrition_link` is a join table between a
  006 table and a 009 table, and its compliance query reads both. Splitting them puts a transaction boundary
  through the middle of a single user-visible calculation.
- **007's coupling is weaker but points the same way.** Generation is a one-shot read of a plan and its
  recipes; the retailer integration is the part that is genuinely separate, and that part is a worker and a
  set of scoped secrets, not a service.

### Why the identity service for 010

- **The entitlement already lives there.** `accounts.subscription_tier` is an identity-service column with an
  identity-service DAO, and 010's own data model adds `plan`, `subscriptionStatus`, `stripeCustomerId`,
  `stripeSubscriptionId`, `currentPeriodEnd`, `cancelAtPeriodEnd` and `trialEndsAt` to the **same account
  row**. A separate billing service would be a **second writer to identity's accounts table** — the exact
  single-writer discipline the food service holds for USDA data, inverted.
- **The alternative puts a synchronous dependency on every authenticated request.** Gating reads the plan; if
  the plan lived in a billing service, either every gated service calls billing on the hot path, or billing's
  state is cached in identity anyway — which is the coupling without the co-location.
- **The claim path is already identity's.** 010 FR-044 puts the entitlement in the Clerk session token's
  `public_metadata`, verified by `@kitchensink/clerk-verify`. Writing that metadata is identity's job.
- **The Stripe webhook belongs in `identity-webhooks`, not in the API.** It is an unauthenticated
  third-party callback that needs the raw request body, must not sit behind Clerk's `AuthMiddleware`, and
  must answer while the API is scaled down — all of which `identity-webhooks` already does for Clerk's svix
  callback. Putting a second webhook next to the first reuses a proven shape; putting it on the ECS service
  reinvents one. - ⚠️ **AMENDED by [ADR-0018](./0018-per-sender-webhook-dedup-tables.md) (2026-08-12).** This bullet
  originally also argued that 010 should reuse the **existing `webhook_events` table**. ADR-0018 rules
  that out: svix's row proves a Clerk _identity_ event was applied and its `identity_id` is `text NOT
NULL`, whereas a Stripe row keys on a customer that may resolve to no identity at all — so sharing the
  table needs a nullable `identity_id`, i.e. deleting the constraint that makes GR-019's no-sentinel rule
  schema-enforced. 010 therefore creates **`stripe_webhook_events`**. The service-ownership decision in
  this bullet stands; only the table-reuse rationale fell.

### The naming consequence, stated rather than hidden

`@kitchensink/recipe-service` will own meal plans, grocery lists and nutrition plans, so its **name will
understate what it holds** — the same complaint the owner already accepted for the food service, which is
really the ingredient service and is not being renamed because renaming is not worth the cost. Read
`recipe-service` as **the user's recipe-and-meal-planning service**. Do **not** propose a rename as a fix,
and do **not** propose a split to make the name true; both are cost with no user-visible benefit.

### When each of these flips

A decision without its reversal conditions is incomplete. Each of these is a genuine trigger, not a hedge:

| Feature | Extract to its own service when…                                                                                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **009** | a DPIA (or a customer contract) requires **physical isolation of GDPR Article 9 health data**. This is the most likely of the four to flip, and it is a compliance trigger rather than an engineering one. → `@kitchensink/nutrition-service` + `@kitchensink/schema-nutrition`. |
| **007** | retailer integration grows **inbound** surface — a Walmart/Instacart webhook, a marketplace callback, or per-user OAuth token storage at a volume that wants its own secret rotation and its own blast radius. → `@kitchensink/grocery-service`.                                 |
| **006** | meal planning grows a **write volume or a scaling profile** that competes with recipe search — i.e. the planner becomes the hot path rather than a premium side feature.                                                                                                         |
| **010** | billing grows **marketplace payments** (Stripe Connect, creator payouts, 1099 reporting — explicitly out of 010's scope today). That surface carries a different regulatory and security posture and should not share a process with authentication.                             |

In every case the extraction cut is the NestJS module boundary named in decision 4, and the cost of the
extraction is a new schema package plus a client base-URL change — which is why the module boundary is
mandatory now even though the service boundary is not.

## Alternatives rejected

### 1. Three new services — `meal-planning`, `grocery`, `nutrition` — one per feature

The shape each feature's `tasks.md` had already drifted toward, and the one a "microservices by default"
reading of the portfolio would produce.

**Rejected on cost and on data integrity, in that order.** Three ECS services per stage plus three more tasks
per open pull request (≈ $25/month per open PR on ADR-0010's measured figure, before RDS, ALB rules and
logical databases), to serve three features with **zero lines of implementation**, on an account with a $300
monthly budget that already runs a NAT _instance_ to save $28/month. And it would put a network boundary
through `meal_plan_entries → recipes`, `meal_plan_nutrition_link → meal_plans`, and grocery generation's read
of a plan's recipes — converting three foreign keys into three eventual-consistency problems, one of which
006 had already started paying for with an orphan handler and an `is_orphaned` flag.

### 2. One new `planning-service` owning all three

The tempting middle: 006 + 007 + 009 share a bounded context ("what the user plans to eat"), so one service
keeps their joins in-process while keeping recipe-service's name honest.

**Rejected — it solves the 006↔009 join and creates the 006↔recipes one.** The single most-referenced foreign
key in all three features points at `recipes`, so any boundary that excludes recipes puts the network in the
busiest place. It also costs a full deployable to buy a naming improvement, and the naming problem is one this
repository has already decided it is willing to live with.

### 3. A separate `billing-service` for 010

Isolates payment code, its Stripe dependency and its PCI-adjacent surface from authentication.

**Rejected — the state it owns is a column on identity's accounts row.** Either billing writes identity's
table (two writers, the failure mode the food service's single-writer rule exists to prevent) or identity
mirrors billing's state (the same coupling, plus a sync job and a staleness window on an **authorization**
decision). The isolation argument becomes correct the moment 010 grows marketplace payouts, which is exactly
why that is the recorded flip condition rather than a dismissal.

### 4. Leave the question open and let implementation decide

The status quo, and the cheapest option today.

**Rejected — it has already been tried and it produced four incompatible answers.** GR-015 §15-b's whole
premise is that a spec which does not name the owner is how the next contributor invents one. The
`packages/api/src/meal-plans/…` and `packages/services/nutrition/…` paths in 006's task file are that
prediction coming true in a document nobody treats as authoritative.

## Consequences

**Accepted costs.**

- **`recipe-service` becomes large** — recipes, collections, search, photos, ratings, ingredients, imports
  (004), meal plans (006), grocery lists (007), nutrition plans (009). This is a modular monolith by choice.
  The discipline that keeps it navigable is the one the service already has: one NestJS module per domain,
  one DAL per module, `*.schema.ts` beside the controller it serves.
- **`@kitchensink/schema-recipe` becomes the largest schema package**, and its derived `openapi.yaml` grows
  well past its current 4,945 lines. That is the intended shape — one contract document per service
  (ADR-0014 decision 6) — but it makes the regenerate-and-diff gate's runtime and the `oasdiff` output
  correspondingly larger.
- **The service name understates its contents.** Stated above; not a bug, not a rename candidate.
- **Blast radius is shared.** A recipe-service incident now also takes down meal planning, grocery lists and
  nutrition. Acceptable at this scale, and the reason 009's compliance trigger is a genuine flip condition
  rather than a formality.
- **GDPR Article 9 data lands in the recipe database.** 009's own plan already carries the two controls that
  matter regardless of service topology — validation errors name the offending **field** and never echo a
  health value, and the unknown-key choice is treated as a data-minimisation control. Physical isolation is
  the flip condition, not the launch posture.

**Known-incomplete work (as of 2026-08-12).**

- **None of these four features is implemented.** This ADR decides where they land, not that they have landed.
- **Four task files need repointing** to the packages decided here (006, 007, 009, 010), and two of them
  additionally specify `class-validator` DTOs, which GR-016 §16-a forbids in a service that has one mechanism.
- **This ADR does not revisit 005, 011, 012 or 013**, each of which already names one or more new services in
  its own spec (`ai-service`, `digitization-service`, `circles-service`, `creator-profiles-service`,
  `cooking-school-service`, plus worker packages). The same question this ADR answers — _does this need its
  own deployable, given what a deployable costs here?_ — is worth asking of each of them before any is built.
  It is **not** answered here, and no conclusion should be inferred from this ADR either way.

---

## Amendment (2026-08-14) — 006 is extracted into its own deployable

**Status of the amendment**: Accepted. Owner decision, 2026-08-14.

**006 gets its own deployable service and its own tables**, superseding the row for 006 in the Decision
table above. 007, 009 and 010 are **unchanged** and remain in the services named there.

| Feature | Owning service (amended)                            | Schema package                  |
| ------- | --------------------------------------------------- | ------------------------------- |
| **006** | `@kitchensink/meal-plan-service` _(new deployable)_ | `@kitchensink/schema-meal-plan` |

**Why, stated honestly.** 006's recorded flip condition above is a _measured_ one — "meal planning grows a
write volume or a scaling profile that competes with recipe search" — and it has **not** been measured,
because 006 is not implemented. This amendment is therefore an **owner architectural decision**, not the
firing of the recorded trigger, and it is recorded as such rather than dressed up as evidence.

Two engineering facts support it, and are the reason it is accepted rather than merely obeyed:

1. **The recipe service's scope grew after this ADR was written.**
   [ADR-0019](0019-recipe-import-spine.md) places the bulk import processor, four channel adapters,
   ingredient resolution and per-entity status emission in the recipe service. The original decision
   weighed 006/007/009 against a service that owned recipe CRUD and search. That is no longer the service
   being weighed, and "one more module" is a materially different proposition against the larger one.
2. **The extraction cost this ADR quantified is lowest before implementation, not after.** The stated cost
   of extracting later is "a new schema package plus a client base-URL change" — but that holds only while
   there is no data to migrate and no consumer pinned to the shared contract. 006 has neither today. Paying
   it now is strictly cheaper than paying it after 006 ships inside `@kitchensink/schema-recipe`.

**What this costs, unchanged from the Context above.** One more ECS service per stage, one more task per
open pull request (≈ $8.25/month each, ADR-0010), an ALB listener-rule priority drawn from the single
allocator in `packages/infra/alb` — **never** a per-service constant (ADR-0003) — a logical database, a
Dockerfile, a deploy job, a smoke test, a schema package, a client package, and a `CONTRACT_HASH` boot
assertion. This amendment does not make a deployable cheap; it accepts the cost for 006 specifically.

**What does NOT follow from this amendment.** It is **not** a precedent that each feature gets a service.
007 and 009 remain in the recipe service, 010 remains in the identity service, and their flip conditions
above are unchanged and still require their stated triggers. The default recorded by this ADR — a new
deployable must be justified against what a deployable costs here — stands.
