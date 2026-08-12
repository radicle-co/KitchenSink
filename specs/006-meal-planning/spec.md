# Feature Specification: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-04-14
**Status**: Draft
**Input**: Split from `001-commise-recipe-app` — meal plan creation, recipe assignment, nutritional summaries, and AI-powered meal suggestions.

## Dependencies

| Spec                                                        | Relationship                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — meal plans assign Recipe entities from the user's collection          |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Required** — nutritional summaries depend on food data                             |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all meal planning requires authentication                             |
| [005-ai-integration](../005-ai-integration/spec.md)         | **Referenced** — AI meal suggestions and auto-generation use AI provider config      |
| [007-grocery-lists](../007-grocery-lists/spec.md)           | **Downstream** — grocery lists are generated from meal plans                         |
| [009-nutrition-planning](../009-nutrition-planning/spec.md) | **Downstream** — nutrition plans link to meal plans for compliance                   |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Referenced** — AI suggestions, auto-generation, and waste optimization are premium |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Meal Planning (Priority: P2)

A user creates a meal plan for a configurable time period (e.g., 1 week, 2 weeks). They can manually assign recipes to specific meals (breakfast, lunch, dinner, snacks) on specific days, or use AI-powered features to suggest meals, auto-generate an entire plan, or optimize for reduced food waste by reusing overlapping ingredients across meals.

**Why this priority**: Meal planning transforms the app from a recipe storage tool into a daily-use lifestyle tool, which is critical for retention and demonstrating premium value.

**Independent Test**: Can be tested by creating a 7-day meal plan, assigning recipes to meals, and verifying the plan displays correctly with all nutritional summaries.

**Acceptance Scenarios**:

1. **Given** a user with recipes in their collection, **When** they create a new meal plan for a date range, **Then** they can assign recipes to specific meals on specific days.
2. **Given** a meal plan in progress, **When** the user requests AI meal suggestions, **Then** the system suggests recipes that fit dietary preferences and available recipes. _(Premium feature)_
3. **Given** a user requests an auto-generated meal plan, **When** they provide preferences and constraints, **Then** the system generates a complete plan they can review and modify. _(Premium feature)_
4. **Given** a meal plan with multiple recipes, **When** the user requests food waste optimization, **Then** the system rearranges or suggests swaps to maximize shared ingredient usage. _(Premium feature)_
5. **Given** a completed meal plan, **When** the user views it, **Then** they see daily and weekly nutritional summaries based on recipe data.

---

### Edge Cases

- How does the system handle very large meal plans (30+ days)?

## Requirements _(mandatory)_

### Functional Requirements

**Meal Planning**

- **FR-022**: System MUST allow users to create meal plans for configurable date ranges with customizable meal slots (breakfast, lunch, dinner, snacks).
- **FR-023**: System MUST allow users to manually assign recipes from their collection to meal slots.
- **FR-024**: System MUST display daily and weekly nutritional summaries for meal plans based on recipe ingredient data.
- **FR-025**: System MUST provide AI-powered meal suggestions based on user preferences, dietary needs, and existing recipes. _(Premium)_
- **FR-026**: System MUST provide auto-generation of complete meal plans based on user-defined constraints. _(Premium)_
- **FR-027**: System MUST provide food waste optimization that suggests recipe arrangements to maximize shared ingredient usage across meals. _(Premium)_

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

- **Meal Plan**: A collection of meal slots organized by date and meal type (breakfast, lunch, dinner, snack). Spans a configurable date range. Can be linked to a nutrition plan. _(See [009-nutrition-planning](../009-nutrition-planning/spec.md))_

## API Contract & Input Validation (GR-015 / GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15 / §15.4 / §15.5](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md) ·
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md). Full
bindings: [`plan.md` §3.0](./plan.md#30-contract-ownership-and-drift-gr-015) and
[`plan.md` §3.0a](./plan.md#30a-input-validation-gr-016), which this section summarises and must not
contradict. **This section applies existing portfolio rules and mints NO new FR** (GR-003). GR-015 decides who
**authors** the contract; GR-016 decides where that zod **runs**.

### Contract ownership (GR-015)

| Role                                        | Binding for 006                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)        | `@kitchensink/recipe-service` — `packages/services/recipe-service/src/meal-plans/*.schema.ts` |
| Schema package (**generated**, committed)   | `@kitchensink/schema-recipe` — `packages/schemas/recipe`, extended, **never hand-edited**     |
| Consuming client                            | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                      |
| Consuming apps / feature packages           | `@commise/web`, `@commise/mobile`, and a `packages/apps/commise/features/*` package           |
| Domain types (a **different** axis, GR-007) | `@kitchensink/recipe-core` — reused `import type`, never re-declared in the schema package    |

✅ **Ownership is decided, not TBD** (ADR-0017, 2026-08-12): 006's paths are **`/api/v1/meal-plans/*`** and they
land in the existing recipe service. **No new deployable is created**, and a **schema package is per SERVICE,
not per feature** — so there is no `@kitchensink/schema-meal-planning`. Adopting the recipe service also means
adopting its prefix, which closes 006's bare-`/v1/*` GR-002 holdout.

**The service MUST** author every meal-plan, entry, nutrition-summary and suggestion request/response shape as
**zod in the service** at `src/meal-plans/*.schema.ts`, **beside the controller it serves**; validate its own
requests with **that same zod**; and keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts`
files**. `@kitchensink/schema-recipe` exports the **zod**, the **`z.infer` types**, a **`CONTRACT_HASH`**, a
**barrel**, and a **DERIVED `openapi.yaml`**.

⛔ **Three properties of that package that look wrong and are not** — do not "correct" them:

- The schema package is a literal file **COPY**, not a transformation. Zod schemas are **runtime values**, so
  they cannot be derived from themselves, and every package exports raw `./src/*.ts` — there is no
  bundle-into-`dist` path to derive through.
- Turbo wires the copy with `$TURBO_ROOT$` **`inputs`**, **NOT** `dependsOn`. That edge is what closes the cycle
  `client → schema → service → client`, and ordering was never the requirement, because the generated files are
  **committed**.
- `openapi.yaml` is **DERIVED OUTPUT** for `oasdiff`, docs and external integrators. It is **NEVER a codegen
  input**: through JSON Schema you lose `readonly`, branded and template-literal types, and discriminated unions
  flatten.

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client
half got skipped portfolio-wide (276 + 144 lines of independently declared client wire types, agreeing with
nothing, survived behind green builds).

- **No meal-plan wire shape is declared anywhere outside the schema package** — including **type-only**
  declarations, and including `packages/apps/**` feature packages (GR-015 §15-b.4).
- Both the **type and the runtime zod** are imported from `@kitchensink/schema-recipe`.
- A genuinely divergent consumer shape — the calendar grid's per-slot view model, a drag-payload model — is
  **DERIVED** with `Pick` / `Omit` / `Partial`, never independently declared. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **006 is also a CLIENT of other services** and is bound identically there: recipe reads via
  `@kitchensink/recipe-service-client` → `@kitchensink/schema-recipe`, nutrition via
  `@kitchensink/food-service-client` → `@kitchensink/schema-food`, AI suggestions via 005. 006 declares no wire
  type belonging to 001, 003, 005, 007 or 009.
- ⚠️ **CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12): the schema-package additions,
  the typed client methods, **response validation on receipt**, and the **contract-skew guard**. "The calendar UI
  will add the type" is a **contract fork, not a task** — and measured 2026-08-12, not one `tasks.md` in the
  portfolio carried these tasks while nine `plan.md` files stated the obligation in prose.

**Drift gates** — inherited from GR-015 §15-c, all three, not reinvented here: the turbo `inputs` rebuild, the
**regenerate-and-diff CI gate**, and the **`CONTRACT_HASH` boot assertion** (the only layer that catches a
deployed service running ahead of a released mobile binary).

⚠️ **Third-party APIs (GR-015 §15-d) — forward-looking for 006.** 006 consumes **no** third-party API directly:
USDA reaches it **transitively** through the food service, and the AI provider sits behind 005. If 006 ever calls
an external API itself, that client is the **OPPOSITE** case — it **validates the raw upstream shape at the
boundary with its own zod**, **MAY declare its own types**, and gets **NO** OpenAPI document.
`packages/clients/usda` is the reference implementation and must never be "converged"; deleting a boundary schema
in the name of this section removes a validation boundary rather than tidying one.

### Input validation — where that zod RUNS (GR-016)

- **One mechanism, one `400`.** Every input above — body, path params (`{id}`, `{entryId}`), query params — is
  parsed by the recipe service's own authored zod via `createZodDto` plus **`nestjs-zod`'s**
  `ZodValidationPipe`. ⚠️ Under Nest's **OWN** `ValidationPipe` a `createZodDto` DTO validates **NOTHING while
  looking correctly wired** — the schema is present, the DTO is referenced, the route reads as validated, and no
  input is checked. It already bit identity's `PATCH /users/me`, and **the only way to observe it is a test that
  posts a known-bad body to a real route and asserts the `400`**.
- **`z.strictObject()` for every mutating body** (GR-017 §17-c, ruled 2026-08-12). Plain `z.object()` needs a
  documented forward-compatibility reason at the schema, which in practice means a **read** surface. On
  `PUT /api/v1/meal-plans/{id}` a silently stripped unknown key is a `200` for an edit that did not happen.
- **Requests are validated in the service; responses are validated ON RECEIPT by the consumer.** ⛔ Server-side
  **response** validation is **DEFERRED by owner decision** (GR-016 §16-g) and **MUST NOT be "completed"** — a
  contributor who adds an emission-side parse is undoing a decision, not closing a gap.
- **⛔ The storage floor — an ASSERTION, never a derivation.** `meal_plan_entries.servings` is `int4`, ceiling
  **2,147,483,647**: this is the live class of defect that made `servings: 9999999999` **a 500 that owed a 400**
  in the recipe service. `plan_type` and `meal_type` are **enum-by-comment `TEXT`**, so the column enforces
  nothing and the domain must be written into the zod. No zod is generated from the storage schema and **no
  storage type enters a wire schema**. **A floor is not a target**: `meal_plans.name` is unbounded `text()` —
  PostgreSQL imposes no limit — so a length cap on user prose is a **product decision 006 owns**. Enforcement is
  the per-service parity test specified in GR-017 §17-d, whose field→column mapping is asserted complete **in
  both directions**.
- **Non-HTTP ingress.** 006 owns **no queue, event or webhook CONSUMER**. Its SQS use for the 005 AI call is
  **outbound / producer** — governed by GR-016 §16-c.2, which validates the outbound body against the callee's
  schema zod **before the send**. If 006 ever consumes (an AI reply, a plan-rollover job), that handler parses
  its payload against an authored zod, because a pipe reaches neither, and an invalid payload is rejected once
  and **never redriven** (GR-018 §18-b).
- **No request-derived value reaches `sql.raw()`.** A request-selected sort or grouping maps through a validated
  enum to a **closed allowlist of literals** in code — the request supplies the key, never the SQL fragment.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-008**: Users can complete a full meal-plan-to-grocery-list workflow in under 10 minutes for a 7-day plan.

## Assumptions

- None specific to this spec beyond those in [001-commise-recipe-app](../001-commise-recipe-app/spec.md).
