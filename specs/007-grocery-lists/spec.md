# Feature Specification: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Created**: 2026-04-14
**Last Updated**: 2026-05-10
**Status**: Pre-handoff (open questions resolved — see revision log in review.md)
**Input**: Split from `001-commise-recipe-app` — grocery list generation from meal plans with ingredient aggregation, deduplication, and online ordering integration.

## Dependencies

| Spec                                                        | Relationship                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| [006-meal-planning](../006-meal-planning/spec.md)           | **Required** — grocery lists are generated from meal plans |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — ingredient data comes from Recipe entities  |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Required** — ingredient identity and unit normalization  |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all grocery features require authentication |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Referenced** — online ordering is a premium feature      |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Grocery List Generation and Online Ordering (Priority: P2)

From a meal plan, a user generates a consolidated grocery list. The list aggregates all ingredients across the planned recipes, combines duplicates (e.g., two recipes needing onions), adjusts quantities, and accounts for items the user already has. The user can then order the groceries online through a supported grocery store — if and when a store integration is available and configured.

**Why this priority**: Grocery list generation is a natural extension of meal planning that delivers tangible time savings. Online ordering integration is a key premium feature that drives subscription value.

**Independent Test**: Can be tested by generating a grocery list from a 3-day meal plan and verifying ingredient aggregation and quantity calculations are correct.

**Acceptance Scenarios**:

1. **Given** a completed meal plan, **When** the user generates a grocery list, **Then** all ingredients are aggregated with combined quantities.
2. **Given** a grocery list, **When** duplicate ingredients exist across recipes, **Then** quantities are summed and displayed as a single line item.
3. **Given** a grocery list, **When** the user marks items as "already have," **Then** those items are excluded from the shopping list.
4. **Given** a grocery list and a configured grocery store integration, **When** the user initiates online ordering, **Then** the system maps ingredients to store products and returns a checkout handoff URL. _(Premium feature — requires store integration to be available and configured; see FR-030 and FR-031.)_
5. **Given** a user has not configured a grocery store, **When** the user attempts to order, **Then** the app guides them through store setup before proceeding.
6. **Given** a user on the dedicated Shopping Lists page, **When** the user creates a new list, **Then** they can start from scratch or link an existing meal plan.
7. **Given** a grocery list linked to a meal plan, **When** the user views the list, **Then** a link back to the originating meal plan is visible and navigable.
8. **Given** a meal plan, **When** the user views the meal plan, **Then** any grocery lists generated from it are listed and navigable from the meal plan view.

---

### Edge Cases

- **Empty meal plan**: Generating a grocery list from a meal plan with no recipes returns an empty list with `totalItems: 0`. The user is shown a prompt to add recipes before generating.
- **Store API outage during ordering**: If the store API is unreachable or returns an error, the grocery list is preserved in its current state. The user sees a clear error message ("Store unavailable — your list is saved. Try again later.") and is not left in a broken state. The order is not marked as placed.
- **Standalone list (no meal plan)**: A list created from the dedicated Shopping Lists page with no meal plan linked behaves identically to a generated list for all in-store and pantry features. Online ordering is available if a store is configured.
- **Meal plan deleted after list generation**: The grocery list persists. The meal plan link is shown as "Meal plan no longer available" rather than a broken link.onfigured any grocery store, **When** they attempt to order online, **Then** the system guides them through store setup and connection.

---

### Edge Cases

- What happens when a user tries to generate a grocery list from an empty meal plan?
- How does the system handle grocery store API outages during online ordering?

## Requirements _(mandatory)_

### Functional Requirements

**Grocery List & Ordering**

- **FR-028**: System MUST generate a consolidated grocery list from a meal plan, aggregating and deduplicating ingredients with summed quantities.
- **FR-029**: System MUST allow users to mark grocery items as "already have" to exclude them from the list.
- **FR-030**: System MUST allow users to configure supported grocery store integrations for online ordering. _(Store integrations are implemented as adapters; availability depends on partner API access — see Assumptions.)_
- **FR-031**: System MUST map grocery list ingredients to store products and provide a checkout handoff URL when a store integration is active. _(Premium — requires FR-030 store to be configured and reachable.)_
- **FR-032**: System MUST provide a dedicated Shopping Lists page where users can view all their lists, create a new standalone list, or generate a list from a meal plan — independent of navigating through the meal plan view.
- **FR-033**: System MUST display a link from a grocery list back to its originating meal plan (when one exists), and display a list of associated grocery lists from within the meal plan view.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

- **Grocery List**: An aggregated, deduplicated list of ingredients. May be generated from a meal plan or created standalone. Items can be marked as "already have" or mapped to store products for online ordering. A list retains a nullable reference to its originating meal plan.

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

| Role                                        | Binding for 007                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Owning service (**authors** the zod)        | `@kitchensink/recipe-service` — `packages/services/recipe-service/src/grocery-lists/*.schema.ts` |
| Schema package (**generated**, committed)   | `@kitchensink/schema-recipe` — `packages/schemas/recipe`, extended, **never hand-edited**        |
| Consuming client                            | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                         |
| Consuming apps / feature packages           | `@commise/web`, `@commise/mobile`, and a `packages/apps/commise/features/*` package              |
| Retailer adapters + order-status polling    | `@kitchensink/recipe-workers` — a **worker plus scoped secrets**, deliberately **not** a service |
| Domain types (a **different** axis, GR-007) | `@kitchensink/recipe-core` — reused `import type`, never re-declared in the schema package       |

✅ **Ownership is decided, not TBD** (ADR-0017, 2026-08-12): `/api/v1/grocery-lists/*` lands in the existing
recipe service. 007's coupling to recipes is weaker than 006's or 009's — generation is a **one-shot read** of a
plan and its recipes — and the genuinely separate part, the **retailer integration, is a worker plus scoped
secrets, not a service**. **No new deployable is created**, and a **schema package is per SERVICE, not per
feature** — there is no `@kitchensink/schema-grocery`. ⚠️ **007's own `tasks.md` is now WRONG**: it names
`packages/services/grocery-service/…` throughout (57 occurrences, measured 2026-08-12), a package that does not
exist and, per ADR-0017, will not. Those paths become `packages/services/recipe-service/src/grocery-lists/…`,
and the retailer adapters plus order-status polling move to `@kitchensink/recipe-workers`.

**The service MUST** author every grocery-list, item, pantry-flag and order request/response shape as **zod in
the service** at `src/grocery-lists/*.schema.ts`, **beside the controller it serves**; validate its own requests
with **that same zod**; and keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts` files**.
`@kitchensink/schema-recipe` exports the **zod**, the **`z.infer` types**, a **`CONTRACT_HASH`**, a **barrel**,
and a **DERIVED `openapi.yaml`**.

⛔ **Three properties of that package that look wrong and are not** — do not "correct" them: the schema package is
a literal file **COPY** (zod are **runtime values**, so they cannot be derived from themselves, and every package
exports raw `./src/*.ts`, so there is no bundle-into-`dist` path); turbo wires it with `$TURBO_ROOT$` **`inputs`**
and **NOT** `dependsOn` (that edge closes the cycle `client → schema → service → client`, and ordering was never
the requirement because the generated files are **committed**); and `openapi.yaml` is **DERIVED OUTPUT** for
`oasdiff`, docs and integrators, **NEVER a codegen input** — through JSON Schema you lose `readonly`, branded and
template-literal types, and discriminated unions flatten.

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client half
got skipped portfolio-wide (276 + 144 lines of independently declared client wire types, agreeing with nothing).

- **No grocery-list wire shape is declared anywhere outside the schema package** — including **type-only**
  declarations, and including `packages/apps/**` feature packages (GR-015 §15-b.4).
- Both the **type and the runtime zod** are imported from `@kitchensink/schema-recipe`.
- A genuinely divergent consumer shape — the check-off list view model, the aisle-grouped projection — is
  **DERIVED** with `Pick` / `Omit` / `Partial`. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- ⚠️ **`storeMapping` and the item `status` enum are OURS**, authored in the recipe service. What comes back from
  a retailer is not — see the exception below.
- ⚠️ **CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12): schema-package additions, typed
  client methods, **response validation on receipt**, and the **contract-skew guard**. "The list screen will add
  the type" is a **contract fork, not a task**.

**Drift gates** — inherited from GR-015 §15-c, all three: the turbo `inputs` rebuild, the **regenerate-and-diff CI
gate**, and the **`CONTRACT_HASH` boot assertion**.

⛔ **THE THIRD-PARTY EXCEPTION (GR-015 §15-d) — Walmart and Instacart are APIs we do NOT serve. NEVER converge
them.** There is no service of ours to own their types and their contracts change without telling us, so their
adapters are the **OPPOSITE** case:

- They **MUST validate the raw upstream wire shape at the boundary with their own zod**, the moment a body
  arrives — product/SKU lookup, cart creation, order placement, and order-status polling alike.
- They **MAY declare their own types**, and the normalized shape they hand back **deliberately differs** from the
  raw retailer payload. That difference is the normalization, not drift.
- **NO OpenAPI document is written for Walmart or Instacart**, and their shapes are never folded into
  `@kitchensink/schema-recipe` as though we owned them. Instacart's `/idp/api/v1/products/*` is likewise
  **exempt from GR-002** — it is their path, not ours.
- `packages/clients/usda` is the reference implementation and its `schemas.ts` must **never** be "converged".
  **Deleting a retailer boundary schema under §15-b is a security regression, not a cleanup**: this path spends
  real money on a user's behalf.

### Input validation — where that zod RUNS (GR-016)

- **One mechanism, one `400`.** Every input — body, path params (`{id}`, `{itemId}`), query params — is parsed by
  the recipe service's own authored zod via `createZodDto` plus **`nestjs-zod`'s** `ZodValidationPipe`. ⚠️ Under
  Nest's **OWN** `ValidationPipe` a `createZodDto` DTO validates **NOTHING while looking correctly wired** (it bit
  identity's `PATCH /users/me`), and **the only way to observe it is a test that posts a known-bad body to a real
  route and asserts the `400`**.
- **`z.strictObject()` for every mutating body** (GR-017 §17-c, ruled 2026-08-12); plain `z.object()` needs a
  documented forward-compatibility reason, which in practice means a **read** surface. On
  `PUT /api/v1/grocery-lists/{id}` a silently stripped key is a `200` for a check-off that did not persist, on a
  screen the user is reading while standing in a shop. ⚠️ The **retailer's** inbound bodies are the opposite case
  and tolerate unknown keys **deliberately**.
- **Requests are validated in the service; responses are validated ON RECEIPT by the consumer** — including the
  retailer's responses, which are **input to us**. ⛔ Server-side **response** validation is **DEFERRED by owner
  decision** (GR-016 §16-g) and **MUST NOT be "completed"**.
- **⚠️ The ORDER path spends real money, so its input bounds are a financial control.**
  `POST /api/v1/grocery-lists/{id}/order` is validated at the boundary **before any retailer call** — an unbounded
  quantity, a duplicated item or an out-of-enum store is rejected here rather than becoming a cart.
- **⛔ The storage floor — an ASSERTION, never a derivation.** `grocery_list_items.usda_fdc_id` and `sort_order`
  are `int4` (ceiling **2,147,483,647**); `quantity_g` is `DECIMAL` **with no declared `(p,s)`**, so ⚠️ **the
  precision and scale must be declared before it can be a floor at all** — bare `numeric` in PostgreSQL is
  effectively unbounded and yields nothing to assert against; and `status`, `store` and `category` are
  **enum-by-comment `TEXT`**, so the column enforces nothing and the domain must be written into the zod. No zod
  is generated from the storage schema and **no storage type enters a wire schema**. **A floor is not a target**:
  `grocery_lists.name` is unbounded `text()`, so its limit is a **product decision 007 owns**. Enforcement is the
  per-service parity test of GR-017 §17-d, its mapping asserted complete **in both directions**.
- **Non-HTTP ingress — 007 has two.** (1) A **`@Cron` pantry-expiry prune**, implied by `user_pantry_items`' 7-day
  TTL, and (2) the **order-status polling** loop. Both run in `@kitchensink/recipe-workers` and both parse their
  own event, because "the payload is ours" is an assumption about a deploy that has already drifted once.
  **Order status is POLLING, not webhooks** — a deliberate MVP decision, since neither candidate partner
  guarantees webhook delivery. ⚠️ **If a signed retailer callback is ever added it gets signature THEN schema**,
  in that order (a signature proves **origin, not shape**), and per GR-018 §18-c a sender that retries on any
  non-2xx is answered **`2xx`** with the rejection in the body, the logs, a per-`reason` counter and an alarm.
- **No request-derived value reaches `sql.raw()`**; a request-selected sort or aisle grouping maps through a
  validated enum to a **closed allowlist of literals** in code.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-004**: Grocery lists generated from a 7-day meal plan accurately aggregate all ingredients within 5 seconds.
- **SC-008**: Users can complete a full meal-plan-to-grocery-list workflow in under 10 minutes for a 7-day plan.
- **SC-009**: Users can reach the Shopping Lists page directly from the main navigation and create a list without first visiting a meal plan.

## Assumptions

- Grocery store integrations are implemented as adapters against third-party APIs (e.g., Walmart Affiliate API, Instacart Connect). **No partner API access is confirmed at spec time.** Walmart is the first adapter to build because its API is publicly documented and key-based; Instacart requires OAuth and a partner agreement. Both adapters are built behind a feature flag and the ordering UI degrades gracefully when no integration is active.
- Store availability varies by user location. The app does not guarantee any specific store is available to any specific user.
- Order status is retrieved by polling `GET /api/v1/grocery-lists/:id/order-status` on a client-driven interval (every 30 seconds). Webhooks are not used in MVP because neither confirmed partner API guarantees webhook delivery; polling is simpler to implement and test without a live integration. This decision is revisited when a partner agreement is in place.
