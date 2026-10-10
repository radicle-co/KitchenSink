# Feature Specification: Nutrition Planning

**Feature Branch**: `009-nutrition-planning`
**Created**: 2026-04-14
**Status**: Draft
**Input**: Split from `001-commise-recipe-app` — nutrition plans with macro targets, meal plan compliance tracking, and trainer-client model.

## Dependencies

| Spec                                                        | Relationship                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [006-meal-planning](../006-meal-planning/spec.md)           | **Required** — nutrition plans link to meal plans for compliance analysis                      |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Required** — nutritional calculations depend on food data                                    |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — recipe nutritional data is the basis for compliance calculations                |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all features require authentication; trainer-client requires user relationships |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Referenced** — trainer nutrition planning and AI recipe swaps are premium features           |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Nutrition Planning (Priority: P3)

A personal trainer or diet-conscious user creates nutrition plans that define daily or weekly caloric and macronutrient targets. They can link meal plans to nutrition plans, and the system tracks whether the planned meals meet the nutritional goals. The system highlights gaps or excesses in the plan.

**Why this priority**: Nutrition planning serves a more specialized audience (trainers, dieters) and builds on top of the meal planning and recipe data foundations.

**Independent Test**: Can be tested by creating a nutrition plan with specific macro targets, linking it to a meal plan, and verifying the system shows compliance or deviation.

**Acceptance Scenarios**:

1. **Given** a user creates a nutrition plan, **When** they define daily calorie and macro targets (protein, carbs, fat), **Then** the plan is saved and visible on their dashboard.
2. **Given** a nutrition plan linked to a meal plan, **When** the user views the plan, **Then** they see a comparison of planned nutrition vs. targets with clear indicators for gaps or excesses.
3. **Given** a personal trainer, **When** they create a nutrition plan for a client, **Then** the client can view the plan and use it to guide their meal planning. _(Premium feature)_
4. **Given** a meal plan does not meet nutrition targets, **When** the user views the analysis, **Then** the system suggests recipe swaps or adjustments to better meet goals. _(Premium feature)_

---

### Edge Cases

None identified specific to this spec.

## Requirements _(mandatory)_

### Functional Requirements

**Nutrition Planning**

- **FR-036**: System MUST allow users to create nutrition plans with daily caloric and macronutrient targets (protein, carbs, fat).
- **FR-037**: System MUST allow linking meal plans to nutrition plans and display compliance analysis.
- **FR-038**: System MUST allow users with appropriate permissions to create nutrition plans for other users (trainer-client model). _(Premium)_
- **FR-039**: System MUST suggest recipe swaps to better align meal plans with nutrition targets. _(Premium)_

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

- **Nutrition Plan**: Defines daily/weekly caloric and macronutrient targets. Can be created for self or for a client (trainer model). Links to meal plans for compliance tracking.

## API Contract & Input Validation (GR-015 / GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15 / §15.4 / §15.5](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md) ·
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md). Full
bindings: [`plan.md` §3.0](./plan.md#30-contract-ownership-and-drift-gr-015) and
[`plan.md` §3.0a](./plan.md#30a-input-validation-gr-016), which this section summarises and must not contradict.
**This section applies existing portfolio rules and mints NO new FR** (GR-003). GR-015 decides who **authors**
the contract; GR-016 decides where that zod **runs**.

### Contract ownership (GR-015)

| Role                                        | Binding for 009                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)        | `@kitchensink/recipe-service` — `packages/services/recipe-service/src/nutrition-plans/*.schema.ts` |
| Paths owned                                 | **BOTH** `/api/v1/nutrition-plans/*` **AND** `/api/v1/trainer/*`                                   |
| Schema package (**generated**, committed)   | `@kitchensink/schema-recipe` — `packages/schemas/recipe`, extended, **never hand-edited**          |
| Consuming client                            | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                           |
| Consuming apps / feature packages           | `@commise/web`, `@commise/mobile`, and a `packages/apps/commise/features/*` package                |
| Nightly compliance rollup                   | `@kitchensink/recipe-workers`                                                                      |
| Domain types (a **different** axis, GR-007) | `@kitchensink/recipe-core` — reused `import type`, never re-declared in the schema package         |

✅ **Ownership is decided, not TBD** (ADR-0017, 2026-08-12), and it covers **both path families** — the trainer
surface is not a separate question. **006 ↔ 009 are two halves of one calculation**: `meal_plan_nutrition_link`
joins a 006 table to a 009 table, so splitting them would put a transaction boundary through the middle of a
single user-visible number. **No new deployable is created**, and a **schema package is per SERVICE, not per
feature** — there is no `@kitchensink/schema-nutrition`.

**The service MUST** author every nutrition-plan, target, link, compliance-report and trainer-client
request/response shape as **zod in the service** at `src/nutrition-plans/*.schema.ts`, **beside the controller it
serves**; validate its own requests with **that same zod**; and keep every `*.schema.ts` importing **only `zod`
and other `*.schema.ts` files**. `@kitchensink/schema-recipe` exports the **zod**, the **`z.infer` types**, a
**`CONTRACT_HASH`**, a **barrel**, and a **DERIVED `openapi.yaml`**.

⛔ **Three properties of that package that look wrong and are not** — do not "correct" them: it is a literal file
**COPY** (zod are **runtime values**, so they cannot be derived from themselves, and every package exports raw
`./src/*.ts`, so there is no bundle-into-`dist` path); turbo wires it with `$TURBO_ROOT$` **`inputs`**, **NOT**
`dependsOn` (that edge closes the cycle `client → schema → service → client`, and ordering was never the
requirement because the generated files are **committed**); and `openapi.yaml` is **DERIVED OUTPUT** for
`oasdiff`, docs and integrators, **NEVER a codegen input** — through JSON Schema you lose `readonly`, branded and
template-literal types, and discriminated unions flatten.

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client half
got skipped portfolio-wide (276 + 144 lines of independently declared client wire types, agreeing with nothing).

- **No nutrition-plan or trainer-client wire shape is declared anywhere outside the schema package** — including
  **type-only** declarations, and including `packages/apps/**` feature packages (GR-015 §15-b.4). Both the **type
  and the runtime zod** come from `@kitchensink/schema-recipe`.
- A genuinely divergent consumer shape — the macro-progress ring model, the compliance chart series, and
  especially a **redacted or trainer-visible projection** — is **DERIVED** with `Pick` / `Omit` / `Partial`, never
  independently declared. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`.
- ⚠️ **On this feature the client half is a PRIVACY control.** These shapes carry **GDPR Article 9 special-category
  health data**. A hand-written client type is a second, unreviewed description of which health fields cross the
  wire, and a data-minimisation review of the service tells you nothing about it. A derived projection **cannot
  silently regain a field**; a separately declared one can.
- ⚠️ **CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12): schema-package additions, typed
  client methods, **response validation on receipt**, and the **contract-skew guard**. "The dashboard will add the
  type" is a **contract fork, not a task**.

**Drift gates** — inherited from GR-015 §15-c, all three: the turbo `inputs` rebuild, the **regenerate-and-diff CI
gate**, and the **`CONTRACT_HASH` boot assertion**.

⚠️ **Third-party APIs (GR-015 §15-d) — forward-looking for 009.** 009 consumes **no** third-party API directly
today; USDA reaches it transitively through the food service. A wearable, fitness-tracker or health-platform
integration is the obvious future candidate, and it is the **OPPOSITE** case: it **validates the raw upstream shape
at the boundary with its own zod**, **MAY declare its own types**, and gets **NO** OpenAPI document. **On health
data that boundary parse is a privacy control as well as a correctness one.** `packages/clients/usda` is the
reference implementation and must never be "converged".

### Input validation — where that zod RUNS (GR-016)

- **One mechanism, one `400`.** Every input across **both** path families — body, path params (`{id}`,
  `{clientId}`), query params — is parsed by the recipe service's own authored zod via `createZodDto` plus
  **`nestjs-zod`'s** `ZodValidationPipe`. ⚠️ Under Nest's **OWN** `ValidationPipe` a `createZodDto` DTO validates
  **NOTHING while looking correctly wired** (it bit identity's `PATCH /users/me`), and **the only way to observe it
  is a test that posts a known-bad body to a real route and asserts the `400`**.
- **`z.strictObject()` for every mutating body** (GR-017 §17-c, ruled 2026-08-12). ⚠️ **Here the unknown-key choice
  is a DATA-MINIMISATION control, not only a correctness one**: `z.object()` strips unknown keys **silently**, so a
  client sending an extra health field gets a `200` and no record of what it tried to send. Rejecting is what makes
  "only necessary fields cross the wire" auditable in one place.
- **⚠️ A validation error names the offending FIELD and NEVER echoes the rejected health value**, and validation
  failures are logged without the payload. The reasoning the plan applies to storage applies to the error path.
- **Requests are validated in the service; responses are validated ON RECEIPT by the consumer.** ⛔ Server-side
  **response** validation is **DEFERRED by owner decision** (GR-016 §16-g) and **MUST NOT be "completed"** — a
  redacted or trainer-visible projection is enforced by being a **derivation** of the wire type, not by an
  emission-side parse.
- **⛔ The storage floor — an ASSERTION, never a derivation, and here it doubles as a safety bound.** Seven `int4`
  columns carry **no declared bounds** beyond the `int4` ceiling of **2,147,483,647**: `daily_calories`,
  `daily_protein_g`, `daily_carbs_g`, `daily_fat_g`, `protein_pct`, `carbs_pct`, `fat_pct`. `activity_level`,
  `goal`, `compliance_status` and `trainer_clients.status` are **enum-by-comment `TEXT`**, so the column enforces
  nothing and the domain must be written into the zod. And the `MacroCalculator` inputs — `weightKg`, `heightCm`,
  `age`, `sex` — have **no declared storage at all**, so they are **inputs needing bounds** with nothing to derive
  from. ⚠️ **A `numeric` column will happily store a 50,000-calorie daily target, so what is medically implausible
  is a PRODUCT DECISION this feature owns** — there is no storage floor to derive it from, and "the column allows
  it" is not an argument. No zod is generated from the storage schema and **no storage type enters a wire schema**;
  enforcement is the per-service parity test of GR-017 §17-d, its mapping asserted complete **in both directions**.
- **Non-HTTP ingress**: **none today.** The two named candidates are a **nightly compliance-rollup job** (in
  `@kitchensink/recipe-workers`) and a **wearable / health-platform ingest**. Each parses its payload against an
  authored zod before acting on it — a scheduled invocation included — and for the ingest that **boundary parse is
  a privacy control as well as a correctness one**, because it decides which health fields may exist in our
  database at all. A signed third-party callback gets **signature THEN schema** (a signature proves **origin, not
  shape**), and an invalid payload is **never retried** (GR-018 §18-b) nor **recorded as a row** (§18-d).
- **No request-derived value reaches `sql.raw()`**; a request-selected metric, interval or sort maps through a
  validated enum to a **closed allowlist of literals** in code.
- ⚠️ **Accepted consequence, not a defect**: Article 9 data lands in the recipe database. ADR-0017 records the flip
  condition — **a DPIA (or a customer contract) requiring physical isolation of Article 9 health data**, the most
  likely of its four decisions to reverse. The two controls above hold regardless of service topology.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-010**: Nutritional calculations for meal plans are accurate to within 5% of the source food database values.

## Assumptions

- The trainer-client relationship for nutrition planning requires explicit consent from the client user.

## Cross-feature note — user-authored food nutrient expansion (added 2026-08-30)

The food catalog's user-authored create endpoint (`POST /api/v1/foods/authored`, decided in
`docs/brainstorms/2026-08-30-ingredient-resolution-pipeline-requirements.md` D9a) launches **macros-only**
(calories, protein, carbs, fat, optional portions) by owner ruling. This feature owns the expansion: when
009 is implemented, widen that endpoint (additively) to accept full nutrient-dictionary rows so
user-authored foods can become as detailed as USDA entries. The expansion inherits D9a's constraints:
provenance stays server-set (`source='user'`), nutrient rows carry user provenance, and only the author
may edit their food.
