# Tech Stack Rationale: Meal Planning

**Branch**: `006-meal-planning` | **Date**: 2026-08-02 (reconciled) | **Status**: Complete
**Sources**: the codebase on `main` (authoritative), [plan.md](../plan.md), [spec.md](../spec.md),
`docs/CODING_STANDARDS.md`, `docs/engineering/ENGINEERING_EXCELLENCE.md`, ADR-0003/0004/0006/0008/0010

> **Reconciliation note.** The 2026-05-09 version of this document derived its choices from the then-current
> `plan.md`/`research.md` rather than from the platform, and three of its six decisions are now known to be wrong: a
> Redis cache tier that no environment has, a per-ingredient USDA nutrition pipeline that duplicates shipped code, and a
> denormalized nutrition snapshot table that would create a second, staleable source of truth. Those are corrected
> below, with the reasoning kept visible rather than quietly deleted.

---

## Library-first gate

`CLAUDE.md` requires that before hand-rolling any non-trivial mechanism, a stable well-maintained library is checked
first and used unless there is a concrete reason not to. The previous plan hand-rolled a circuit breaker, an
exponential-backoff retry, calendar/date maths and a graph algorithm without running this gate. Outcomes:

| Mechanism                         | Decision                                                                        | Reason                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP client (recipe gateway)      | **`ky`** — already the platform's client (`@kitchensink/recipe-service-client`) | Native `AbortSignal` timeouts and hooks; matching the shipped client keeps one HTTP idiom.                                                                                                                                                                      |
| Retry / backoff                   | **`ky`'s built-in `retry`**, bounded, on idempotent GETs only                   | Hand-rolled backoff was the old ARCH-016. `ky` already implements bounded retry with jitter; a bespoke one is reinvention.                                                                                                                                      |
| Circuit breaker                   | **Not used** — replaced by the Gateway's availability discipline                | A breaker adds shared mutable state and a tuning surface for a call that is already a total function returning `unavailable`. The shipped `FoodCatalogGateway` solves the same problem without one, and matching it is worth more than the marginal protection. |
| Calendar / date maths             | **`date-fns`** (tree-shakeable, immutable, locale-aware `startOfWeek`)          | FR-037 needs DST-safe calendar-date arithmetic and locale first-day-of-week. Hand-rolling this is the classic source of off-by-one-day bugs across time zones.                                                                                                  |
| Validation / parsing              | **`zod`** — already the platform standard                                       | Parse-don't-validate at the controller edge; brands the id types.                                                                                                                                                                                               |
| Waste-optimization graph (FR-027) | **Deferred with Phase 2**                                                       | Not implemented in Phase 1, so no library decision is made now. Deciding it today would be speculative.                                                                                                                                                         |

---

## Frontend planner interaction

### Choice

**Web**: `@dnd-kit/core` + `@dnd-kit/sortable`. **Mobile**: no drag library — tap-to-assign via a recipe picker sheet,
long-press for move/remove.

### Rationale

- `@dnd-kit` is selected specifically for its **keyboard sensor and screen-reader announcements**. NFR-003 requires a
  keyboard-operable equivalent for every drag interaction; a pointer-only library would fail the requirement outright.
  Accessibility is the deciding factor, not ergonomics.
- `@dnd-kit` is a **web-only** dependency. It is never imported from `@kitchensink/meal-plan-core` or from shared
  feature code — only from `.tsx` files that Metro will not resolve on native.
- Mobile deliberately does **not** get drag-and-drop. Dragging a card across a scrolling week grid on a phone competes
  with the scroll gesture and is a well-known source of mis-drops. Tap-to-assign is fewer interactions
  (SC-006-002) and needs no gesture arbitration.

### Trade-offs

| Trade-off                                    | Mitigation                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Two interaction models to test               | Both drive the **same** shared command surface (`useMealPlanBoard`); only the trigger differs, so the logic under test is one implementation. |
| Assembly work vs. a turnkey scheduler widget | A generic scheduler models events on a timeline, not recipes in named slots; the domain composition is the point.                             |
| `@dnd-kit` bundle cost on web                | Loaded with the planner route, not on Home; the widget does not import it.                                                                    |

---

## Backend and persistence

### Choice

NestJS 11 + Drizzle on the **shared** RDS PostgreSQL 16 instance, in its own logical database
`kitchensink_meal_plans`. Three domain tables (`meal_plans`, `meal_plan_entries`, `meal_plan_templates` + template
entries) plus an idempotency ledger. **No** `meal_plan_nutrition` table.

### Rationale

- Mirrors the shipped `recipe-service` and `food-service` exactly: same framework, same ORM, same shared-instance /
  own-logical-database pattern (ADR-0006), same migration-runner arrangement. Divergence here would buy nothing.
- Relational fit is strong: entries are (plan, date, slot) tuples with range and membership constraints that Postgres
  `CHECK`s can enforce, so illegal rows cannot be written even by a buggy service.

### Corrections to the previous version

- **The `meal_plan_nutrition` table is removed.** It was justified as an aggregation-cost mitigation, but totals are a
  pure fold over at most 360 entries — microseconds. Persisting them buys nothing and costs correctness: a recipe edited
  after the rollup leaves the stored totals silently wrong, and there is no invalidation path (spec C-006-003).
- **The SQS async-recalculation layer is removed.** It existed only to keep the write path fast while the (now removed)
  snapshot table caught up. With no snapshot there is nothing to recalculate, so the queue, the DLQ, the worker and the
  "updating nutrition" UI state all disappear. This feature has **no** async work.
- **Foreign keys to `users` and `recipes` are removed** — no local users table exists by design, and recipes are in a
  different logical database (spec C-006-002).

---

## Nutrition

### Choice

Aggregate **recipe-level** per-serving nutrition, computed by the shipped
`@kitchensink/recipe-core/nutrition`, multiplied by each entry's servings, folded by a pure function in
`@kitchensink/meal-plan-core`. Fetched in **one bounded batch call** to the recipe service.

### Rationale

This is the single largest correction in this document. The platform already contains a careful implementation of the
hard part:

- Per-100g macros are already denormalized onto recipe ingredient rows
  (`packages/services/recipe-service/src/database/schema/ingredients.ts`).
- `packages/shared/recipe-core/src/nutrition.ts` already folds those into per-serving `RecipeNutrition`, handling
  user-entered overrides, mass-unit conversion, household-measure portions, and — critically — an `isComplete` flag that
  marks a total as a partial estimate when any line cannot be accounted for.
- `Recipe` already carries `leadCaloriesPerServing` (denormalized at write time) and `hasPartialNutrition` on the
  **list** projection, precisely so cards render without an N+1.

The old design (`ARCH-017 UsdaFoodDataAdapter`, batch-fetching nutrients per ingredient from "the USDA API") would have
reimplemented all of that, worse: no partial-estimate concept, no unit conversion, and a dependency on a source that 003
deliberately abstracted behind `food-source-adapter.ts`. **006 does not call the food service at all.**

### Trade-off

| Trade-off                                                 | Mitigation                                                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requires an additive batch endpoint on the recipe service | Tracked as an explicit cross-feature prerequisite in `plan.md` and `tasks.md`; it is additive (no existing route changes) and keeps the one macro computation on the producing side. |
| Totals recompute on every read                            | The fold is pure and O(entries ≤ 360); the cost is one bounded network call, not the arithmetic.                                                                                     |

---

## Resilience

### Choice

A **Gateway** (PoEAA) in front of the recipe service, modelled on the shipped `FoodCatalogGateway`: bounded transport
timeout via a real `AbortSignal`, a total function that never throws, boundary normalization, rate-limited failure
logging, and a three-state `availability` discriminant.

### Rationale

Reading a plan now depends on another service's availability. The platform already has a documented, tested answer to
exactly that problem, including the reasoning for why `Promise.race` timeouts leak and why `availability` must be
three-state rather than boolean. Reusing it means a recipe-service blip degrades the planner to partial nutrition with
an explicit caveat instead of returning 503.

### Corrections

No Redis, no ElastiCache, no cache tier of any kind. None exists in this platform, and ADR-0004 (t4g.nano NAT),
ADR-0007 (nightly sandbox shutdown, micro RDS) and ADR-0008 ($300 account budget) exist specifically to keep spend of
this shape out. The previous `ARCH-009 NutritionalSummaryCache` (Redis, TTL 3600) appeared in eight v-model documents and
was never costed.

---

## AI integration (Phase 2 — deferred)

### Choice

FR-025/026/027 are **not implemented in Phase 1**. No AI dependency, no provider adapter, no premium guard ships.

### Rationale

Two independent blockers, both factual rather than schedule-related:

1. **005 does not exist** — there is no AI provider surface to adapt to. Designing an adapter against a guessed contract
   is what produced the previous version's `AiProviderAdapter { invoke(prompt) → { suggestions: string[] } }`.
2. **The premium entitlement cannot be enforced.** The old design read `tier` from the session token's
   `public_metadata`. On `main`, `public_metadata` carries only `scopes`/`permissions` — asserted by
   `packages/shared/clerk-verify/src/__tests__/clerkVerify.test.ts` ("reads authorization grants ONLY from
   public_metadata, never a top-level scopes claim") — while `subscriptionTier` lives in the identity service's
   `accounts` table (`packages/shared/identity-db/src/dao/account.dao.ts`). A guard reading `tier` from the token would
   read `undefined` and return 402 for every user, including premium ones.

Phase 1 ships the capability seam (the Home widget's capability gate) and nothing premium. When 005 and 010 land, the
adapter is designed against their real contracts.

---

## Stack mapping to research questions

| RQ   | 2026-05 decision                 | 2026-08 decision                                                                           |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| RQ-4 | `@dnd-kit` for drag-drop         | `@dnd-kit` **on web only**, chosen for its keyboard sensor; tap-to-assign on mobile        |
| RQ-5 | Domain calendar components       | Unchanged — slot-centric primitives shared across week/month and across platforms          |
| RQ-6 | 3-table relational model         | Revised — plans/entries/templates + idempotency ledger; **no** nutrition table, **no** FKs |
| RQ-7 | Snapshot + rollup nutrition      | **Reversed** — pure read-time fold over recipe-level nutrition; no snapshot, no cache      |
| RQ-8 | 001 consumption + 007 handoff    | Unchanged in intent; 006 exposes a read projection and generates no lists                  |
| RQ-9 | 003 USDA nutrition + 009 linkage | **Reversed** — 006 never calls the food service; nutrition comes from the recipe service   |

## Resolved requirement gaps

The 2026-05 WARNING (recurrence, templates, family sizing not covered by FRs) is now closed by spec
**C-006-008**: templates are in scope as **FR-028**, family sizing is explicit as **FR-030** (entry servings), and
recurring schedules and leftover tracking are deferred with recorded reasoning.
