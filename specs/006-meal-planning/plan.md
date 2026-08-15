# Implementation Plan: Meal Planning

**Branch**: `006-meal-planning` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-meal-planning/spec.md`
**Supersedes**: the 2026-04/05 draft, which predated the delivery of 001, 002 and 003 and specified a data model,
nutrition pipeline, cache tier and package layout that do not match the shipped platform. Every decision below is
anchored to code on `main`; where the old plan and the codebase disagreed, the codebase won.

## Summary

Meal planning as a new platform service, `@kitchensink/meal-plan-service` (NestJS 11 on ECS/Fargate, Drizzle + its own
logical database on the shared RDS instance), plus a Commise product feature package `@commise/features-meal-plan`
supplying the planner UI and the Home widget on both web and mobile.

The three decisions that shape everything else:

- **Nutrition is a pure aggregation over recipe-level nutrition, not an ingredient pipeline.** 001 already denormalizes
  per-100g macros onto recipe ingredient rows and already computes per-serving recipe nutrition as a pure function with
  an `isComplete` partial-data flag (`@kitchensink/recipe-core/nutrition`). 006 sums `recipeNutrition × servings` and
  propagates partiality. It calls **the recipe service**, never the food service, and there is no cache tier
  (spec C-006-003, C-006-005).
- **No cross-service foreign keys, no replicated recipe state, no event bus.** `owner_id` is the app-user ULID with no
  FK (001's "D2"); `recipe_id` is a bare `uuid`. An entry whose recipe is no longer readable is detected **at read
  time** and rendered orphaned — 001 deletion is a soft-delete tombstone, so there is nothing to be notified about
  (spec C-006-002, C-006-006).
- **Web and mobile ship together, with different interactions over one shared core.** Assignment logic, validation,
  totals and query definitions live in shared packages; only the interaction and render layers fork — pointer
  drag-and-drop plus a keyboard-operable equivalent on web, tap-to-assign on mobile (spec FR-034, `CODING_STANDARDS §14`).

Phase 1 implements FR-022/023/024 and FR-028..FR-039. Phase 2 (FR-025/026/027 — AI suggestions, auto-generation, waste
optimization) is **deferred**: it is blocked on 005 for the provider surface and on 010 for the premium entitlement,
which cannot be enforced today because `subscriptionTier` lives in the identity service's `accounts` table and is not a
token claim (spec C-006-009).

## Technical Context

| Aspect                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Language/Version**     | TypeScript 5.9.x, Node.js 24.x (per `.nvmrc` + `package.json` engines)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Primary Dependencies** | NestJS 11, Drizzle ORM, `pg`, `zod` (env + boundary parsing), `@nestjs/config`, `@kitchensink/clerk-verify` (session-token verification, ULID claim), `@kitchensink/recipe-service-client` (recipe reads and batch nutrition), `@kitchensink/recipe-core` (pure nutrition aggregation, branded ids, access policy), `ky` (HTTP, mirroring the shipped clients), `@tanstack/react-query` v5, `ditox` + `@ditox/react` (Home widget registration), `@dnd-kit/core` + `@dnd-kit/sortable` (web pointer/keyboard drag only), `date-fns`, `@commise/i18n`, `@commise/ui` |
| **Storage**              | The **shared** RDS PostgreSQL 16 instance, own logical database `kitchensink_meal_plans` (mirrors `kitchensink_recipes` / `kitchensink_food`; **no new RDS instance**, ADR-0006 per-PR logical DB derivation). No S3, no SQS, no cache.                                                                                                                                                                                                                                                                                                                             |
| **Testing**              | Vitest (unit + integration), Playwright (web E2E), Maestro (mobile E2E), k6 via `packages/tools/loadtest`; Docker PostgreSQL + LocalStack for integration; TDD red → green; pyramid ≥ 70% unit / ≤ 20% integration / ≤ 10% E2E                                                                                                                                                                                                                                                                                                                                      |
| **Target Platform**      | AWS Fargate (ECS) behind the shared per-stage ALB; Next.js 15 web; Expo 57 / RN 0.86 mobile                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Project Type**         | Web service (NestJS REST API) + web app + mobile app + shared/product packages. **No worker Lambdas, no queues** — this feature has no async work (contrast 001, which needed both).                                                                                                                                                                                                                                                                                                                                                                                |
| **Performance Goals**    | p95 ≤ 500 ms for a **30-day** plan read with nutrition (NFR-006 / SC-006-003); downstream request count bounded and independent of entry count at any supported size. Per PRF-006-11 (residual accepted), there is deliberately **no** separate p95 target at the 90-day maximum.                                                                                                                                                                                                                                                                                   |
| **Constraints**          | Plan span ≤ 90 days (FR-022); nutrition read MUST NOT be N+1 (requires the additive recipe-service batch projection below); calendar dates are `YYYY-MM-DD`, never instants (FR-037); every user-facing string localized (FR-038)                                                                                                                                                                                                                                                                                                                                   |
| **Scale/Scope**          | Same envelope as 001 — 10k concurrent users; a plan is bounded at 90 days × 4 slots, so an entry set is small and fully page-able in one read                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Verified against the KitchenSink Constitution **v1.3.0** (the previous draft checked v1.1.0's seven principles and
predated Principle VIII entirely).

| #    | Principle                                                                                   | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | **Correctness & Type Safety** — strict TS, no `any`, proper error types, ISO dates          | ☑️ Pass | Strict TS from the shared base config. Branded ids (`MealPlanId`, `MealPlanEntryId`, `TemplateId`) extend the `@kitchensink/recipe-core/ids` pattern. Domain errors are `*Error` classes extending `Error` with `Object.setPrototypeOf` and matching `is*` guards (`CODING_STANDARDS §6`) — **not** the `*Exception` names the old draft used. All dates are ISO 8601 strings in interfaces; calendar dates are `YYYY-MM-DD` (FR-037). |
| II   | **Readability & JSDoc** — JSDoc on all exports, module headers, named exports               | ☑️ Pass | Every export carries JSDoc; every module header names the pattern it implements (see **Pattern Register**). Named exports only.                                                                                                                                                                                                                                                                                                        |
| III  | **Code Organization & Imports** — aliased imports, `.js` extensions, no `helpers/`          | ☑️ Pass | Platform/product split per `CODING_STANDARDS §5.1`. Service code is organized **by feature domain** (`plans/`, `entries/`, `templates/`, `nutrition/`) — the old `module-design.md` grouped by generic type (`controllers/`, `services/`, `repositories/`), which `§3` forbids. No `helpers/`; `lib/` reserved for third-party wrappers.                                                                                               |
| IV   | **Testing Discipline** — pyramid, `getByRole`/`getByLabel`, no `waitForTimeout`             | ☑️ Pass | Full `§7.1` matrix, test-first. Backend integration tests are `__tests__/integration/**/*.integration.test.ts` and e2e `tests/e2e/*.e2e.test.ts`, matching the shipped recipe service. k6 through `packages/tools/loadtest`.                                                                                                                                                                                                           |
| V    | **Monorepo & Workspace Governance** — workspaces registered, shared tooling, Turbo tasks    | ☑️ Pass | Four new workspaces, all inside existing globs (`packages/services/*`, `packages/shared/*`, `packages/clients/*`, `packages/apps/commise/features/*`). Shared tsconfig/ESLint/Prettier. Turbo tasks declared. Per-PR logical DB via ADR-0006.                                                                                                                                                                                          |
| VI   | **Formatting & Tooling** — Prettier/ESLint shared configs, hooks, CI gates                  | ☑️ Pass | Shared configs; `eslint-plugin-check-file` enforces the two file-naming regimes (kebab `name.type.ts` in the service, camelCase/PascalCase in the product/shared packages).                                                                                                                                                                                                                                                            |
| VII  | **Accessibility & UX Consistency** — accessible names, design tokens, non-colour state      | ☑️ Pass | Drag-and-drop has a keyboard-operable equivalent (NFR-003) — the reason `@dnd-kit` is chosen over a pointer-only library. Partial-nutrition, orphaned and gated states pair colour with text (NFR-004). Tokens from `@commise/ui`.                                                                                                                                                                                                     |
| VIII | **Cross-Platform Parity & Code Sharing** — lockstep release, shared-code-first, `.native.*` | ☑️ Pass | Paired web + mobile tasks throughout `tasks.md` (`§14.1`); shared logic in `@kitchensink/meal-plan-core` and `@commise/features-meal-plan`; platform variants use `.native.tsx`. **No waiver taken** — the Complexity Tracking table records none.                                                                                                                                                                                     |

Any justified deviation MUST be documented in the **Complexity Tracking** table below.

## Pattern Register

Required by `CLAUDE.md` → _Design-pattern-first development_, item 4. The previous plan carried none. These are the
patterns in force for this feature; new work cites the pattern it implements, and reviews lead with them.

### Prescribed

| Pattern                                                 | Where                                                                | Why it fits                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gateway** (PoEAA)                                     | `RecipeGateway` in the service — the only door to the recipe service | Mirrors the shipped `FoodCatalogGateway`: bounded transport timeout, total function (never throws), boundary normalization, log-flood discipline, and a three-state `availability` discriminant. A plan read must degrade, not 500, when recipes are slow. |
| **Repository**                                          | `plans/`, `entries/`, `templates/` persistence                       | Owner-scoped query surface; keeps Drizzle out of domain code.                                                                                                                                                                                              |
| **Value Object**                                        | `DateRange`, `MealSlot`, `DayOffset`, `Servings` in `meal-plan-core` | Makes illegal states unrepresentable: a `DateRange` cannot exist inverted or over-long, so no downstream code re-checks it.                                                                                                                                |
| **Branded nominal ids**                                 | `MealPlanId`, `MealPlanEntryId`, `MealPlanTemplateId`                | Extends the shipped `@kitchensink/recipe-core/ids` Zod-brand pattern so a `RecipeId` can never be passed where a `MealPlanId` is expected.                                                                                                                 |
| **Specification / policy module**                       | `mealPlanAccessPolicy` in `meal-plan-core`                           | One authoritative, pure, fail-closed statement of "may this viewer see/modify this plan", called identically by service and both clients — the same reason `recipeAccessPolicy` exists (001 defect D7: web and mobile implemented different rules).        |
| **Pure aggregation (fold)**                             | `aggregatePlanNutrition` in `meal-plan-core`                         | Totals are a pure fold over `(recipeNutrition, servings)` pairs. Deterministic, trivially unit-testable, and the reason no cache is needed.                                                                                                                |
| **Adapter**                                             | `toGroceryProjection` (FR-036)                                       | Versioned outbound shape for 007/009, decoupled from the internal row model.                                                                                                                                                                               |
| **Discriminated union + exhaustive switch** (= Visitor) | entry render state: `assigned \| orphaned \| pending`                | The union plus an exhaustive `switch` **is** Visitor; no visitor machinery is added.                                                                                                                                                                       |
| **Headless hook + render component**                    | `useMealPlanBoard` (orchestration) over pure presentational cells    | Presentational components stay pure `props → JSX`; all mutation/statechart logic sits in the hook, shared across platforms.                                                                                                                                |
| **Command** (= TanStack mutation)                       | assign / move / remove / apply-template                              | TanStack `useMutation` **is** Command — intent object, execution, rollback. No extra command layer.                                                                                                                                                        |
| **Registry + lazy loader**                              | Home widget descriptor in `@commise/features-meal-plan`              | The shipped `@commise/features-core` widget contract; the widget registers a **loader**, not a component.                                                                                                                                                  |

### Deliberately preserved (do not "refactor" away)

- `FoodCatalogGateway`'s availability discipline is the template for `RecipeGateway`. Its three-state `availability`
  discriminant is not a boolean and must not be flattened into one.
- `@kitchensink/recipe-core/nutrition` is the single authoritative per-serving recipe nutrition computation. 006 consumes
  it; 006 does not reimplement, wrap, or "improve" macro maths.
- `recipeAccessPolicy` remains the authority on recipe readability. 006 never re-derives recipe visibility rules.

### Intent already satisfied — do not add machinery

- **Strategy** for per-platform assignment interaction is satisfied by Metro's `.native.tsx` resolution; no strategy
  registry.
- **Observer** for orphan detection is satisfied by read-time resolution (spec C-006-006); no event bus, no webhook.
- **Proxy** for lazy widget loading is satisfied by `next/dynamic` (web) and `React.lazy` (mobile), per 001's widget
  surface.

### Purity and refs

Per `CLAUDE.md`: functions are pure unless they perform I/O, mutation or external calls, and impure ones carry
`@sideEffect`. **The old plan's `NutritionCalculator` interface, with a `triggerOnEntryAdd(entry): void` method, is
deleted** — a side-effecting method on a "calculator" is exactly the shape this rule forbids. Refs are near-forbidden;
the only permitted use in this feature is `@dnd-kit`'s sensor attachment to DOM nodes, which is a genuinely external
non-declarative system.

## Project Structure

### Documentation (this feature)

```text
specs/006-meal-planning/
├── spec.md              # Feature specification (reconciled 2026-08-02)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── research/            # Product Forge research layer
├── product-spec/        # Product Forge product layer + wireframes (web + mobile)
├── v-model/             # V-Model artifacts (requirements → design → test → trace)
├── checklists/          # Requirements checklist
└── tasks.md             # Phase 2 output — single numbering, test-first, paired web+mobile
```

### Source Code (repository root)

```text
packages/
├── services/
│   └── meal-plan-service/              # @kitchensink/meal-plan-service — NestJS 11 REST API (Fargate)
│       ├── src/                        #   organized BY FEATURE DOMAIN (CODING_STANDARDS §3), not by type
│       │   ├── plans/                  #   meal-plans.controller.ts / .service.ts / dal/
│       │   ├── entries/                #   meal-plan-entries.controller.ts / .service.ts / dal/
│       │   ├── templates/              #   meal-plan-templates.controller.ts / .service.ts / dal/
│       │   ├── nutrition/              #   plan-nutrition.service.ts (orchestrates gateway + pure fold)
│       │   ├── recipes/                #   recipe.gateway.ts — the ONLY door to the recipe service
│       │   ├── erasure/                #   account-erasure participation (FR-039)
│       │   ├── auth/                   #   AuthMiddleware over @kitchensink/clerk-verify (no local users table)
│       │   ├── common/                 #   apiException.filter.ts (one error envelope), idempotency, pagination
│       │   ├── config/                 #   Zod env schema
│       │   ├── database/               #   Drizzle schema + hand-authored SQL migrations
│       │   └── health/
│       ├── __tests__/integration/      #   *.integration.test.ts (Docker Postgres)
│       ├── tests/e2e/                  #   *.e2e.test.ts (real Postgres + LocalStack, driven over HTTP)
│       └── infra/                      #   CDK: MealPlanServiceStack (+ bin/app.ts)
├── shared/
│   └── meal-plan-core/                 # @kitchensink/meal-plan-core — pure domain, zero runtime deps beyond zod
│       └── src/
│           ├── ids.ts                  #   branded MealPlanId / MealPlanEntryId / MealPlanTemplateId
│           ├── mealPlan.types.ts       #   MealPlan, MealPlanEntry, MealPlanTemplate, DayNutrition (ISO dates)
│           ├── dateRange.ts            #   DateRange value object — calendar dates, DST-safe (FR-037)
│           ├── mealSlot.ts             #   MealSlot union + ordering
│           ├── nutritionRollup.ts      #   aggregatePlanNutrition — pure fold over recipe-core nutrition
│           ├── mealPlanAccessPolicy.ts #   pure, fail-closed owner predicates
│           ├── templateProjection.ts   #   plan ⇄ template (relative day offsets)
│           ├── groceryProjection.ts    #   FR-036 versioned outbound shape
│           └── mealPlanDatabaseName.ts #   leaf module, NO imports — ADR-0006 derivation (see note below)
├── clients/
│   └── meal-plan-service/              # @kitchensink/meal-plan-service-client — typed client + TanStack queries
│       └── src/                        #   client.ts, queries.ts, hooks.ts, errors.ts, testing/, __integration__/
└── apps/commise/
    ├── features/
    │   └── meal-plan/                  # @commise/features-meal-plan — product UI (web + mobile)
    │       └── src/
    │           ├── board/              #   MealPlanBoard.tsx + .native.tsx, DayColumn, SlotCell, EntryCard
    │           ├── hooks/              #   useMealPlanBoard — shared orchestration (headless)
    │           ├── create/             #   plan creation flow (date range + slot selection)
    │           ├── templates/          #   save-as-template + apply-template
    │           ├── nutrition/          #   NutritionSummary (partial-estimate presentation)
    │           ├── widget/             #   MealPlanHomeWidget.tsx + .native.tsx (FR-035)
    │           └── messages.ts         #   LocalizedMessages (FR-038)
    ├── features/core/                  # MODIFIED — retire the 'meal-plan' roadmap placeholder (FR-035)
    ├── web/                            # MODIFIED — /[locale]/meal-plan route, widget registration
    └── mobile/                         # MODIFIED — planner screen, nav item, widget registration, skeleton removal
```

**Structure Decision**: Follows the shipped 001 topology exactly. Backend, shared domain and typed client are
**platform** packages (`@kitchensink/*` under `packages/{services,shared,clients}/`); the planner UI and Home widget are
**product** packages (`@commise/*` under `packages/apps/commise/`), per `CODING_STANDARDS §5.1`. The service uses the
**shared RDS instance with its own logical database** `kitchensink_meal_plans` — no new instance — provisioned by a
`MealPlanDbBootstrap` custom resource mirroring `FoodDbBootstrap`/`RecipeDbBootstrap` (passwordless IAM-auth
`meal_plan_app` role), with the endpoint imported via `Fn.importValue` like the others.

`mealPlanDatabaseName.ts` is a **leaf module with no imports**, imported as
`@kitchensink/meal-plan-core/database-name` and deliberately **not** re-exported from the barrel — the identical
constraint documented on `recipeDatabaseName.ts`, whose violation (defect #119) pointed a service and its workers at two
different databases in production. A cross-stack parity test is part of this contract, not an optional extra.

## Data Model

Three tables in `kitchensink_meal_plans`. Hand-authored SQL under `src/database/migrations/` is the DDL the in-VPC
migration runner applies; the Drizzle definitions mirror it exactly, as in `recipe-service`.

```sql
-- A user's plan over a calendar range. owner_id is the app-user ULID from the verified token claim:
-- VARCHAR(255), NO foreign key, no local users table (001 "D2"; spec C-006-002).
CREATE TABLE meal_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      varchar(255) NOT NULL,
  name          text         NOT NULL,
  start_date    date         NOT NULL,
  end_date      date         NOT NULL,
  meal_slots    text[]       NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT meal_plans_range_check  CHECK (end_date >= start_date),
  CONSTRAINT meal_plans_span_check   CHECK (end_date - start_date <= 89),   -- ≤ 90 days inclusive (FR-022)
  CONSTRAINT meal_plans_slots_check  CHECK (
    cardinality(meal_slots) BETWEEN 1 AND 4
    AND meal_slots <@ ARRAY['breakfast','lunch','dinner','snack']::text[]
  )
);
CREATE INDEX meal_plans_owner_created_idx ON meal_plans (owner_id, created_at DESC, id DESC);  -- keyset paging

-- One recipe assigned to one (date, slot) cell. recipe_id is a bare uuid: recipes live in a DIFFERENT
-- logical database, so a foreign key is unenforceable — and would contradict FR-033's orphan semantics.
CREATE TABLE meal_plan_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id  uuid         NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  recipe_id     uuid         NOT NULL,
  entry_date    date         NOT NULL,
  meal_slot     text         NOT NULL,
  servings      integer      NOT NULL DEFAULT 1,
  note          text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT meal_plan_entries_servings_check CHECK (servings BETWEEN 1 AND 99),   -- REQ-CN-008
  CONSTRAINT meal_plan_entries_slot_check     CHECK (meal_slot IN ('breakfast','lunch','dinner','snack')),
  CONSTRAINT meal_plan_entries_note_check     CHECK (note IS NULL OR length(note) <= 500)
);

-- REQ-CN-010 / C-006-012: a cell holds AT MOST ONE entry. Every wireframe draws a cell as either the
-- `+` add affordance or exactly one card, and mobile's flow is "tap an EMPTY slot", so a second occupant
-- is a state no surface can render. Enforced here rather than in application code for the same reason as
-- the span and servings bounds: a bound that lives only above the database is one a future caller
-- bypasses. This REPLACES the plain index — the constraint's index serves the same read path.
-- Note this does NOT retire the idempotency ledger; see Complexity Tracking.
--
-- DEFERRABLE is load-bearing, not decoration. REQ-021's swap updates two rows, and a non-deferrable
-- unique index is checked as each row is written *within* the statement — so the first row to move
-- collides with the second row that still occupies the target cell, and the swap fails no matter how
-- the UPDATE is written. INITIALLY IMMEDIATE keeps ordinary inserts failing fast with good error
-- locality; only the swap transaction issues
--     SET CONSTRAINTS meal_plan_entries_cell_uniq DEFERRED;
-- so the pair is validated once at COMMIT.
ALTER TABLE meal_plan_entries
  ADD CONSTRAINT meal_plan_entries_cell_uniq
  UNIQUE (meal_plan_id, entry_date, meal_slot)
  DEFERRABLE INITIALLY IMMEDIATE;
-- ⚠️ Consequence to honour at implementation: a deferrable unique constraint cannot serve as an
-- `ON CONFLICT` arbiter, so the assign path MUST detect the collision from the raised unique violation
-- (mapped to the "that slot was just filled" domain error, REQ-NF-008) rather than upserting. That is
-- the behaviour REQ-003 wants anyway — a silent upsert would overwrite the entry that won the race.

-- REQ-CN-009: an entry's date must fall inside its plan's range. Postgres CHECK cannot reach another
-- table, so this is a trigger rather than a constraint — the alternative (validating only in the service)
-- is exactly the "bounds only in application code" failure REQ-CN-005/008 reject.
CREATE FUNCTION meal_plan_entries_in_range() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM meal_plans p
    WHERE p.id = NEW.meal_plan_id
      AND NEW.entry_date BETWEEN p.start_date AND p.end_date
  ) THEN
    RAISE EXCEPTION 'entry_date % outside plan range', NEW.entry_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meal_plan_entries_in_range_trg
  BEFORE INSERT OR UPDATE OF entry_date, meal_plan_id ON meal_plan_entries
  FOR EACH ROW EXECUTE FUNCTION meal_plan_entries_in_range();

-- The invariant has TWO sides. Guarding only the entry lets `PATCH /api/v1/meal-plans/{id}` shrink a range
-- and strand entries outside it — the same violation, reached from the other table. This is the
-- enforcement half of the API contract's "never shrinks below existing entries without warning": the
-- service asks for confirmation, and the database refuses to be talked past.
CREATE FUNCTION meal_plans_range_covers_entries() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM meal_plan_entries e
    WHERE e.meal_plan_id = NEW.id
      AND e.entry_date NOT BETWEEN NEW.start_date AND NEW.end_date
  ) THEN
    RAISE EXCEPTION 'plan range %..% would strand existing entries', NEW.start_date, NEW.end_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meal_plans_range_covers_entries_trg
  BEFORE UPDATE OF start_date, end_date ON meal_plans
  FOR EACH ROW EXECUTE FUNCTION meal_plans_range_covers_entries();

-- A reusable template: entries by RELATIVE day offset, never absolute date (FR-028).
CREATE TABLE meal_plan_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      varchar(255) NOT NULL,
  name          text         NOT NULL,
  span_days     integer      NOT NULL,
  meal_slots    text[]       NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT meal_plan_templates_span_check CHECK (span_days BETWEEN 1 AND 90)
);
CREATE TABLE meal_plan_template_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid         NOT NULL REFERENCES meal_plan_templates(id) ON DELETE CASCADE,
  recipe_id     uuid         NOT NULL,
  day_offset    integer      NOT NULL,
  meal_slot     text         NOT NULL,
  servings      integer      NOT NULL DEFAULT 1,
  CONSTRAINT meal_plan_template_entries_offset_check CHECK (day_offset >= 0)
);
CREATE INDEX meal_plan_template_entries_template_idx ON meal_plan_template_entries (template_id, day_offset, meal_slot);

-- Idempotency ledger (FR-032). Scoped to (owner, endpoint, key) so one user's key cannot replay another's.
-- Retention: 24h. Pruned OPPORTUNISTICALLY inside the same transaction as an idempotency write
-- (bounded to 50 rows per write, scoped to that owner) — no scheduled job, no worker, no pg_cron.
-- The table only grows while it is being written to, which is exactly when pruning runs.
CREATE TABLE meal_plan_idempotency_keys (
  owner_id      varchar(255) NOT NULL,
  endpoint      text         NOT NULL,
  idempotency_key text       NOT NULL,
  response_body jsonb        NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, endpoint, idempotency_key)
);
CREATE INDEX meal_plan_idempotency_created_idx ON meal_plan_idempotency_keys (created_at);
```

**Deliberately absent, and why:**

| Removed from the old draft            | Reason                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meal_plan_nutrition` table           | Totals are a pure fold over current recipe nutrition. Persisting them creates a second source of truth that silently goes stale when a recipe is edited (C-006-003). |
| `fiber_g_total`                       | Unobtainable — shipped `RecipeNutrition` is calories/protein/carbs/fat only (C-006-004).                                                                             |
| `is_locked`, `plan_type`              | Lock dropped as YAGNI (C-006-007). `plan_type` was redundant with the date range.                                                                                    |
| `user_id UUID REFERENCES users(id)`   | No local users table exists, by design (C-006-002).                                                                                                                  |
| `recipe_id … REFERENCES recipes(id)`  | Cross-database FK, unenforceable, and contradicts orphan semantics (C-006-002, C-006-006).                                                                           |
| `is_orphaned` / `orphaned_at` columns | Orphan state is derived at read time, not stored — a stored flag would need the deletion notification that deliberately does not exist (C-006-006).                  |

## API Contracts

**Contract-first**: the OpenAPI document under `specs/006-meal-planning/contracts/` is written **before** any handler,
per `ENGINEERING_EXCELLENCE.md` → Backend §1. Handlers derive from it; the e2e suite asserts against it.

| Method | Path                                         | Auth | Notes                                                                                                                                                                                          |
| ------ | -------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/meal-plans`                         | ✔    | Owner's plans, **cursor (keyset) paginated** — not offset                                                                                                                                      |
| POST   | `/api/v1/meal-plans`                         | ✔    | Create; `422` on invalid range/slots                                                                                                                                                           |
| GET    | `/api/v1/meal-plans/{id}`                    | ✔    | Plan + entries + per-day nutrition in **one** response                                                                                                                                         |
| PATCH  | `/api/v1/meal-plans/{id}`                    | ✔    | Rename / adjust range (never shrinks below existing entries without warning)                                                                                                                   |
| DELETE | `/api/v1/meal-plans/{id}`                    | ✔    | Cascades to entries                                                                                                                                                                            |
| POST   | `/api/v1/meal-plans/{id}/entries`            | ✔    | **`Idempotency-Key` required** (FR-032)                                                                                                                                                        |
| PATCH  | `/api/v1/meal-plans/{id}/entries/{entryId}`  | ✔    | Move / re-serve / re-note. A move onto an **occupied** cell swaps the two entries in one transaction with the cell constraint deferred (REQ-021); a move onto an empty cell is a single update |
| DELETE | `/api/v1/meal-plans/{id}/entries/{entryId}`  | ✔    | Idempotent — repeat returns success-shaped                                                                                                                                                     |
| GET    | `/api/v1/meal-plans/{id}/grocery-projection` | ✔    | FR-036 read projection for 007/009. **Generates nothing.**                                                                                                                                     |
| GET    | `/api/v1/meal-plan-templates`                | ✔    | Owner's templates                                                                                                                                                                              |
| POST   | `/api/v1/meal-plan-templates`                | ✔    | Save an existing plan as a template                                                                                                                                                            |
| POST   | `/api/v1/meal-plan-templates/{id}/apply`     | ✔    | **`Idempotency-Key` required**; returns new plan + skip report                                                                                                                                 |
| DELETE | `/api/v1/meal-plan-templates/{id}`           | ✔    | —                                                                                                                                                                                              |
| GET    | `/health`                                    | ✖    | The only unauthenticated route                                                                                                                                                                 |

Conventions, all inherited rather than invented: one error envelope `{ code, message, details? }` emitted by a single
`apiException.filter.ts`; `401` unauthenticated, `404` for both absent and not-owned (FR-029 — never `403`, which would
disclose existence), `409` genuine conflict, `422` semantically invalid, `503` when the recipe gateway is unavailable
**and** the request cannot be served degraded. Zod parses at the controller edge so the interior only sees valid data.

### 3.0 Contract ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). This section states the
bindings for this feature; the rule lives there and wins on any detail.

✅ **RESOLVED (2026-08-12) — `/api/v1/meal-plans/*` is owned by `@kitchensink/recipe-service`**, per
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md).
**No new deployable service is created for 006.**

| Role                                  | Binding for 006                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)  | `@kitchensink/recipe-service` — `packages/services/recipe-service/src/meal-plans/*.schema.ts` |
| Schema package (generated, committed) | `@kitchensink/schema-recipe` — `packages/schemas/recipe`, **extended, never forked**          |
| Consuming client                      | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                      |
| Consuming apps                        | `@commise/web`, `@commise/mobile`, and a `packages/apps/commise/features/*` package           |
| NestJS module (internal boundary)     | `MealPlansModule`, a sibling of the shipped `RecipesModule` / `SearchModule`                  |

**The one-line reason, specific to 006**: every join this feature has is against `recipes`
(`meal_plan_entries.recipe_id`, §2), and in **one** database `ON DELETE CASCADE` deletes 006's
recipe-deletion orphan handler and its `is_orphaned` column outright — so this decision **removes** a task, a
column and a background job rather than adding them. 006 ↔ 009 are additionally **two halves of one
calculation**: 009's `meal_plan_nutrition_link` joins a 006 table to a 009 table.

**A schema package is per SERVICE, not per feature.** 006 adds `*.schema.ts` files under
`packages/services/recipe-service/src/meal-plans/`, beside the controller they serve, and the **existing**
generator copies them into the **existing** `@kitchensink/schema-recipe` (⚠️ **re-measured 2026-08-12: 10**
authored schema files and a **5,700**-line derived `openapi.yaml`, correcting the "8 authored / 4,945-line" figures
this line carried from 2026-08-11 — the `versions` and `api-error` copies have since landed, and the derived
document is **generated**, so `ls` the directory and `wc -l` the file rather than quoting).
There is **no** `@kitchensink/schema-meal-planning`, and 006 does not get
one. 004 already set this precedent for the recipe service — add to `packages/schemas/recipe`, never fork it.

**The NestJS module is the internal boundary, and it is mandatory now even though the service boundary is
not.** `MealPlansModule` sits beside `RecipesModule` with its own DAL and its own `*.schema.ts` beside its
controller. A future extraction cuts at **that module edge**, and its cost is a new schema package plus a
client base-URL change — which is exactly why the module edge cannot be skipped today.

**Flip condition (ADR-0017)**: extract 006 into its own service when meal planning grows a **write volume or
a scaling profile that competes with recipe search** — i.e. when the planner becomes the hot path rather than
a premium side feature.

**`@kitchensink/recipe-service` MUST**:

- Author every meal-plan, entry, nutrition-summary and suggestion request/response shape as **zod in the
  service** at `src/meal-plans/*.schema.ts`, beside the controller it serves.
- **Validate its own requests with that same zod** via `nestjs-zod`'s `createZodDto` — not a separate
  `class-validator` DTO that agrees with the schema by convention. ⚠️ 006 adds **no** `class-validator` DTO to
  the 19 files already being removed from that service (re-measured 2026-08-12).
- Extend the committed `@kitchensink/schema-recipe`, which exports the zod, `z.infer` types,
  `contractHash.ts`, a barrel, and a **derived** `openapi.yaml` (outbound only — for `oasdiff`, docs and
  integrators, **never a codegen input**).
- Keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts` files**.

**Every client MUST** — separately mandatory, because mandating only the service half is exactly how the
client half got skipped portfolio-wide (276 + 144 lines of redeclared wire types survived behind green
builds):

- Import its wire **types and zod** from `@kitchensink/schema-recipe`.
- **Declare no meal-plan request or response body type of its own** — not in `packages/clients/*`, and not in
  `@commise/web` / `@commise/mobile` / a feature package either (GR-015 §15-b.4).
- **Derive** any divergent consumer shape with `Pick` / `Omit` / `Partial` over the wire type. The calendar
  grid's per-slot view model is the obvious case here: it is a derivation of the entry wire type, never a
  parallel interface. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **006 is also a CLIENT of other services** and §15-b binds it there identically: nutrition data via
  `@kitchensink/food-service-client` → `@kitchensink/schema-food`; recipe reads via
  `@kitchensink/recipe-service-client` → `@kitchensink/schema-recipe`; AI suggestions via 005 →
  `@kitchensink/schema-ai`. **006 declares no wire type belonging to 001, 003, 005 or 007.**
- **A new endpoint is not complete until its types are reachable from the schema package.** "The calendar UI
  will add the type" is a contract fork, not a task.

**Drift gates** — inherited from GR-015 §15-c, all three required, not reinvented per feature: turbo
`inputs`-driven rebuild, a **regenerate-and-diff CI gate** (the strong gate), and a `CONTRACT_HASH` **boot
assertion** (the only layer that catches a deployed service running ahead of a released mobile binary).

**⚠️ Third-party APIs (GR-015 §15-d).** 006 consumes no external API directly today. If one is added, it is
the **opposite** case: we do not serve it, so its client **validates the raw upstream shape at the boundary
with zod**, **may declare its own types**, and **gets no OpenAPI document**. `packages/clients/usda` is the
reference implementation and its `schemas.ts` must never be "converged".

> ✅ **Paths below are FIXED (2026-08-12).** Adopting `@kitchensink/recipe-service` means adopting its prefix,
> so every path in this plan moved from bare `/v1/meal-plans/*` to canonical **`/api/v1/meal-plans/*`**. That
> closes the GR-002 holdout this plan previously flagged (GR-002 Current State recorded 006 as the last one).
> The shipped recipe-service controllers additionally answer the bare `/v1/*` form as a **deprecated alias**,
> for URLs external consumers already hold ([ADR-0011](../../docs/architecture/decisions/0011-api-version-prefix.md)) —
> 006's paths are new, so they get **no** alias.

### 3.0a Input validation (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. ✅ **§3.0 now names the owner** —
`@kitchensink/recipe-service` (ADR-0017) — so every obligation below binds a package that exists.

- **One mechanism, one `400`.** Every meal-plan, entry, nutrition-summary and suggestion input — body, path
  params (`{id}`, `{entryId}`), query params — is parsed by `@kitchensink/recipe-service`'s own `*.schema.ts`
  zod via `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. 006 adds **no** `class-validator` DTO to the
  19 files already being removed there (re-measured 2026-08-12: 18 `ZodValidationPipe`, 26 `createZodDto`, 19
  `class-validator` files — two mechanisms in one service, mid-convergence).
- **⛔ THE FLOOR — 006's own bodies reach it.** `POST /api/v1/meal-plans/{id}/entries` carries **`servings`**,
  which is one of the five int-backed fields measured with **no upper bound** against an `integer` (`int4`)
  column capped at **2,147,483,647**. Every input field writing a bounded column is validated at least as
  strictly as the column can store — `servings`, entry counts, `mealType` / `planType` enums, nullability,
  and the `startDate` / `endDate` / `date` values (ISO-8601 strings per CODING_STANDARDS, so a **format and a
  plausible range**, not just "a string").
    - ⚠️ **Asserted, never derived**: no zod generated from Drizzle, no storage type imported into a
      `*.schema.ts`. §3.0's import constraint is unchanged by GR-016.
    - ⚠️ **The floor is a floor.** A `meal_plans.name` writing an unbounded `text()` column has **no storage
      bound to derive from**, so its length limit is a product decision 006 owns.
    - ✅ **OPEN-GR-016-A is CLOSED (ruled 2026-08-12, GR-017 §17-d):**
      the floor is enforced by a **per-service boundary-parity test**, not a review checklist. It lives in
      `@kitchensink/recipe-service` (beside `recipes/dto/__tests__/numericBounds.dto.test.ts`, the existing
      example); it **may import both** the Drizzle schema and the authored zod, because **a test is not a wire
      schema**; it **derives** the bounded-column enumeration from the Drizzle schema rather than typing it
      out; and it asserts the field→column mapping complete **in both directions** — every bounded column has
      an entry or a reasoned exemption, and every entry names a column that exists. Without the second
      direction the test silently shrinks to the fields someone remembered and stays green.
- **Range inputs are inputs.** A plan window (`startDate`/`endDate`) and any calendar range query bound the
  work the request can ask for: a reversed or absurd range is rejected at the boundary rather than becoming a
  query that scans a year of entries. Cross-field rules like `endDate >= startDate` live **in the schema**
  (a zod refinement), so the client sees the same rule the server enforces.
- **Non-HTTP ingress — 006 is a queue PRODUCER, not a consumer.** §7 _Resilience_ specifies an **async SQS
  pattern for the outbound 005 AI call**; that is 006 **publishing** a message, which GR-016 §16-c.2 governs
  (the outbound body is validated against the callee's schema-package zod **before** the send), not §16-b.
  006 declares **no queue, event or webhook CONSUMER** today. ⚠️ The two claims previously stood side by side
  in this plan and read as a contradiction; they are not one — the direction is what differs. **If 006 ever
  consumes** (an AI-suggestion **reply** off a queue, or a plan-rollover job — both plausible), that handler
  **parses its payload against an authored zod before acting on it**, because a pipe reaches neither, and an
  invalid payload is rejected once and **never redriven**
  ([GR-018](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) §18-b).
- **006 is a CLIENT of several services**, and GR-016 §16-c binds both directions: outbound bodies validated
  against the callee's schema-package zod **before the call** — nutrition via `@kitchensink/schema-food`,
  recipe reads via `@kitchensink/schema-recipe`, AI suggestions via `@kitchensink/schema-ai` — and each
  **response validated on receipt**.
- ✅ **Unknown keys — OPEN-GR-016-B is CLOSED (ruled 2026-08-12, GR-017 §17-c):**
  **`z.strictObject()` is the portfolio default for every mutating request body**, so 006's `POST`/`PUT`/`DELETE`
  bodies reject unknown keys. Plain `z.object()` is permitted only with a **documented forward-compatibility
  reason at the schema**, which in practice means a **read** surface (a calendar-range query string an older
  service may receive from a newer client). `PUT /api/v1/meal-plans/{id}` is the case the ruling protects: a
  silently stripped key returns `200` for an edit that did not happen, and silence is the worse failure.
- **No request-derived value reaches `sql.raw()`**; a request-selected sort or grouping maps through a
  validated enum to a closed allowlist of literals in code.
- **⛔ Response validation is DEFERRED (GR-016 §16-g).** Do not plan or task server-side response parsing.

### Prerequisite — additive change to the recipe service (same owner)

FR-024 with NFR-006 cannot be met by reading each recipe individually: a 90-day × 4-slot plan is up to 360 entries. The
recipe service must expose a **batch nutrition projection**:

```
POST /api/v1/recipes/nutrition-batch      { recipeIds: string[] }   →   { results: Array<{
    recipeId: string; nutrition: RecipeNutrition | null; }> }
```

`nutrition: null` means "not readable by this caller" — the signal 006 turns into orphan state (FR-033), with no
existence disclosure. This is **additive** to the shipped recipe service (no existing route changes), is bounded (≤ 360
ids, chunked by the gateway), and reuses `@kitchensink/recipe-core/nutrition` on the producing side so there is exactly
one macro computation in the platform. Tracked as T001–T003 against `packages/services/recipe-service`, and it MUST
land before 006's nutrition tasks.

**Ownership**: the recipe service and this feature share one owner, so this needs no cross-party acceptance. It is
still sequenced as its own phase because it modifies a **deployed** service: the change stays strictly additive and is
covered by consumer-driven contract tests that fail in the recipe service's own CI (ITS-015-C4), so a later change to
the provider cannot silently break this consumer.

The path uses the platform's plain-segment convention (`/nutrition-batch`, not `/nutrition:batch`) — settled while the
endpoint still had no clients, which was the cheapest moment to settle it.

### Prerequisite — the `/api/{version}/` route convention (LANDED UPSTREAM, ADR-0011)

**Status: done, not by 006.** The owner's directive was implemented platform-wide in `main` before 006 reached
implementation — `docs/architecture/decisions/0011-api-version-prefix.md`, delivered by `daac10c6`, `9658ed05`,
`22e8ef15`, `ac06d703`, `dcd13187`, `1422c4b8`. 006's earlier T073–T076 migration plan is **withdrawn as redundant**;
this section records what the shipped design means for 006 rather than what 006 must do.

What landed, and how it differs from what 006 had planned:

| 006's plan                                        | What shipped                                                                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setGlobalPrefix('api', { exclude: ['health'] })` | **Controller path arrays** — `@Controller(['api/v1/recipes', 'v1/recipes'])`. ADR-0011 §"How it is implemented" rejects a global prefix explicitly: it cannot express the alias.                         |
| A `/v1/*` → `/api/v1/*` rewrite middleware        | No middleware. Both paths are registered natively, so the alias inherits auth, validation and error handling by construction rather than by a rewrite.                                                   |
| Fix the auth exclusion to the prefixed path       | **Both** spellings excluded (`app.module.ts:82`), with the fail-closed reasoning 006 flagged recorded in a comment — the erasure callers are Lambdas that deploy independently and may dial either path. |
| Migrate recipe-service only, flag food + identity | All three services, the typed clients, both apps, the k6 scripts and the CI probes moved together.                                                                                                       |

**The one constraint this places on T002.** ADR-0011 §Consequences: _"the alias is a fixed set that only ever
shrinks."_ A **new** endpoint must therefore be canonical-only — giving `nutrition-batch` an alias would grow a set
the ADR says only shrinks, and there is no legacy consumer to serve. Since `recipes.controller.ts` is declared with
both paths, the batch projection cannot live on it. It gets its own controller declared with the canonical path
alone:

```ts
@Controller('api/v1/recipes')   // canonical only — no alias; ADR-0011 §Consequences
export class RecipeNutritionController { … }
```

Two controllers sharing a base path is the established shape here — `ratings.controller.ts:35` already sits on
`recipes`' base alongside `recipes.controller.ts`.

## Nutrition Aggregation

```
GET /api/v1/meal-plans/{id}
  → load plan + entries                                          (1 query)
  → RecipeGateway.batchNutrition(distinct recipeIds)             (1 bounded call, chunked)
  → aggregatePlanNutrition(entries, nutritionByRecipeId)         (pure fold, no I/O)
```

`aggregatePlanNutrition` is a pure function in `@kitchensink/meal-plan-core`:

- An entry contributes `recipeNutrition × entry.servings` for each of calories, protein, carbs, fat.
- An entry whose recipe returned `null` (unreadable → orphaned) contributes **nothing** and sets the day's
  `isComplete` to `false`.
- An entry whose recipe nutrition is itself `isComplete: false` contributes its values and sets the day's `isComplete`
  to `false` — the same partial-estimate discipline `recipe-core` already applies per recipe.
- A day with **no** entries yields **no** totals (`undefined`), never zeroes (spec US-006-003 scenario 3).
- The plan total is the fold of the day totals, `isComplete` being the conjunction.

This mirrors, and deliberately does not duplicate, `recipe-core`'s own line-level discipline. The function is
exhaustively unit-tested including the boundary cases (0 entries, 1 entry, all-orphaned, mixed-partial) and is the
natural home for property-based tests (`ENGINEERING_EXCELLENCE.md` → QSE §4): summation is associative and
order-independent, and `isComplete` is monotonically destroyed.

## Recipe Gateway — availability discipline

Modelled directly on the shipped `FoodCatalogGateway`, because a plan read now depends on another service's
availability:

1. **Bounded transport timeout** via a real `AbortSignal`, not `Promise.race` (which leaks pending requests).
2. **It never throws.** Failure degrades to "nutrition unavailable for these ids", which renders as partial totals with
   an explicit caveat, so a recipe-service blip degrades the planner instead of 500-ing it.
3. **Normalization at the boundary** — an unparseable payload is dropped, not leaked inward.
4. **Log discipline** — failures reported at most once per interval, the rest at `debug`.
5. **Three-state `availability` discriminant** (`available | unavailable | degraded`), not a boolean.

Chunking is the gateway's concern: callers pass all ids; the gateway splits to the batch limit and merges.

## Frontend Architecture

**Shared (`@commise/features-meal-plan`)** — `useMealPlanBoard`, a headless orchestration hook over TanStack Query
mutations (Command), exposing `assign`, `move`, `remove`, `setServings`, `setNote` and a derived board view model.
Presentational components (`DayColumn`, `SlotCell`, `EntryCard`, `NutritionSummary`) are pure `props → JSX`. Entry
render state is a discriminated union (`assigned | orphaned | pending`) consumed by an exhaustive switch, so a new state
fails `typecheck` rather than rendering blank.

Per `CODING_STANDARDS §11`, states that switch the render tree are composed by the parent, not passed as boolean flags —
`EntryCard` does not take an `isOrphaned` prop; the parent selects `AssignedEntryCard` or `OrphanedEntryCard` from the
union.

| Platform | Interaction                                                                                        | Layout                                                                   |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Web      | `@dnd-kit/core` + `@dnd-kit/sortable` pointer drag **plus** its built-in keyboard sensor (NFR-003) | Week grid (7 day columns × slot rows); month view collapses to day cells |
| Mobile   | Tap cell → recipe picker sheet; long-press entry → move/remove (**no** drag-and-drop)              | Vertical day list with slot sections                                     |

`@dnd-kit` is chosen specifically because it ships an accessible keyboard sensor and screen-reader announcements —
pointer-only drag would fail NFR-003 outright. It is a **web-only** dependency and is never imported from shared code.

### Home widget (FR-035)

`@commise/features-meal-plan` exports `./widget/web` and `./widget/mobile` and registers a **loader** (not a component)
with the `@commise/features-core` contract, gated on `ROADMAP_CAPABILITIES.mealPlanning`. In the same change, the
`meal-plan` entry is removed from `ROADMAP_WIDGET_SPECS` and each app's `meal-plan` skeleton is deleted — the procedure
that module documents. Because `RoadmapWidgetId` is a literal union feeding a total per-app `Record`, a half-done
retirement fails `typecheck`.

## Infrastructure & Deployment

- **Compute**: one Fargate service behind the **shared** per-stage ALB (`SharedAlbStack`, ADR-0003). 006 imports the
  HTTPS listener and adds a host-based rule. It does **not** create an ALB.
- **Listener priority**: base stages **400** (identity 100, food 200, recipe 300). Per-PR band **50000–59999**, named
  ephemeral band **60000–69999** — disjoint from food (10000/20000) and recipe (30000/40000), mirroring
  `recipeListenerPriorityForStage`. Reusing an occupied band is the documented "Priority already in use" failure.
- **Subnets**: public with `assignPublicIp`, inbound locked to the ALB SG, egress via IGW — **not** the NAT (ADR-0004).
  This service has no VPC-attached Lambdas, so it adds no NAT consumers.
- **Database**: logical DB on the shared instance via ADR-0006 derivation; per-PR DB derived from the base stage.
- **Tagging**: `Environment=global` for base stages; `Environment=pr-{N}` for per-PR deploys, with resources named
  `kitchensink-meal-plan-*-pr-{N}` (ADR-0005). Never tag or name a persistent resource `pr-{N}`.
- **Task sizing** (decided here so the cost below is derived, not guessed — PRF-006-21): **`cpu: 512`,
  `memoryLimitMiB: 1024`, `desiredCount: 1`** per stage, matching the shipped `recipe-service` and `food-service` API
  tasks exactly. This service is I/O-bound with no CPU-heavy path — its only computation is a pure fold over ≤ 360
  entries — so there is no case for a larger task, and matching the neighbours keeps one sizing decision in the
  platform instead of three.
- **Cost**: non-prod runs `FARGATE_SPOT` and `gp3`; prod runs on-demand `FARGATE` (ADR-0008). With the sizing above,
  a per-PR preview is **one Spot task at 0.5 vCPU / 1 GB**, i.e. the same shape as the food service's per-PR API task,
  whose measured cost is ≈ **$8.25/mo** (ADR-0010). Expect the same order for this service; it adds **no** NAT
  consumers, **no** bucket, **no** queue and **no** cache, so compute is essentially the whole bill. Recorded because
  ADR-0008's $300 account budget is a real constraint, not a formality.
  **Residual**: this is derived from a stated configuration and a measured comparable, not from this service's own
  billing data. Confirm from Cost Explorer after the first preview deploy (T070).
- **CI**: a `deploy-meal-plan` job in `.github/workflows/sandbox-deploy.yml` gated **ensure-exists** through
  `.github/scripts/deploy-gate.sh` (ADR-0010), not on changed paths. Post-deploy smoke asserts the ecosystem: the
  running task's `RECIPE_SERVICE_URL` is this stage's recipe origin and that origin answers, where **`401`/`403`/`429`
  are the PASS** (the endpoint requires a Clerk token). Teardown is by tag or name via the existing
  `teardown-sandbox-pr.sh`; 006 adds no new public DNS of its own beyond the service subdomain.
- **No** S3 bucket, **no** SQS queue, **no** worker Lambda, **no** cache cluster.

## Testing Strategy

Test-first, per `CODING_STANDARDS §7.1` and `ENGINEERING_EXCELLENCE.md` → QSE. Every test file opens with a block
comment mapping requirement IDs to test descriptions (`§7`).

| Tier                     | Scope                                                                                                                            | Location                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Unit                     | `meal-plan-core` (all pure: date range, rollup, template projection, access policy, grocery projection); every service unit      | `__tests__/*.test.ts` co-located                         |
| Property-based           | `aggregatePlanNutrition` invariants; `templateProjection` round-trip                                                             | `__tests__/*.test.ts`                                    |
| Integration              | Repositories + controllers against **real** Docker PostgreSQL; gateway against a stubbed HTTP server incl. timeout/5xx/malformed | `__tests__/integration/*.integration.test.ts`            |
| E2E (service)            | Boot the Nest app against real Postgres + LocalStack, drive over HTTP incl. auth, idempotency replay, orphan flow                | `tests/e2e/*.e2e.test.ts`                                |
| k6                       | 30-day plan read p95 ≤ 500 ms (SC-006-003); assignment burst; gateway-degraded profile                                           | `packages/tools/loadtest`                                |
| Component (web + mobile) | **Every** state: loading, empty, populated, partial-nutrition, orphaned-entry, saving, error, offline                            | `__tests__/*.test.tsx` and `*.native.test.tsx`           |
| Playwright (web)         | One flow per user story, `getByRole`/`getByLabel` only, no `waitForTimeout`; includes keyboard-only assignment                   | `packages/apps/commise/web/tests/e2e/*.spec.ts`          |
| Maestro (mobile)         | One flow per user story                                                                                                          | `packages/apps/commise/mobile/.maestro/meal-plan/*.yaml` |

Adversarial requirements, not optional extras: assert **outcomes not calls**; integration tests use the real dependency,
not mocks; every error path asserts the exact error type and status; the gateway's failure modes (timeout, 5xx,
malformed body, partial batch) each have a test; and the acid test — "would this still pass if the code were broken?" —
is applied in review, with the mutate-a-condition experiment run on boundary logic (span limits, servings bounds,
`isComplete` propagation).

## Web/Mobile Parity Enforcement

Inherits 001's FR-044a mechanism. Every frontend task in `tasks.md` MUST satisfy one of:

1. covers both platforms explicitly (names both paths), or
2. has a paired task that references it, or
3. carries a `[PARITY-EXCEPTION]` note naming the future spec that closes the gap.

Pre-approved exceptions needing no note: Playwright (web) vs. Maestro (mobile) for the same flow; `@dnd-kit` pointer
drag as a **web-only enhancement** over the shared assignment command, since mobile provides the equivalent tap
interaction required by FR-034 (this is an interaction fork, not a capability gap — both platforms expose the same
operations).

A frontend task covering one platform without a documented exception is a blocking defect.

## Complexity Tracking

> All 8 constitution principles pass. **No parity waiver is taken.** Three deviations from "simplest possible" are
> justified below; the previous plan's genuinely unjustified complexity (a cache tier, a nutrition table, a lock
> mechanism, a per-ingredient nutrient pipeline) has been removed rather than justified.

| Deviation                                                           | Why needed                                                                                                                                                                                                                       | Simpler alternative rejected because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New service `@kitchensink/meal-plan-service` (4 new workspaces)     | Distinct bounded context with its own lifecycle and release cadence; keeps three scheduled destructive workers in `kitchensink_recipes` away from planning data (spec C-006-001).                                                | A module inside `recipe-service` was seriously considered — nutrition and recipe reads are local there. Rejected because it widens the blast radius of the recipe erasure/prune/orphan sweepers to a second bounded context, for a saving of ~$8/mo/stage.                                                                                                                                                                                                                                                                                                                                            |
| Additive batch nutrition endpoint on the **shipped** recipe service | Without it, a 360-entry plan read is 360 recipe reads and NFR-006 is unreachable.                                                                                                                                                | Per-entry reads (N+1) fail the latency budget. Caching recipe nutrition in 006 would create a second, staleable source of truth (C-006-003, C-006-005).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| An idempotency ledger table                                         | `POST /entries` and template application are non-idempotent writes on a mobile network; `ENGINEERING_EXCELLENCE.md` → Backend §1 requires `Idempotency-Key` on such endpoints. A retried assignment must not double-book a slot. | **Corrected 2026-08-02 (C-006-012).** This row previously rejected a uniqueness constraint on the premise that "FR-023 permits … the same cell to hold repeats" — FR-023 granted no such thing, and every wireframe draws a cell as `+` or exactly one card. The constraint is now **adopted** (REQ-CN-010) and the ledger is **still required**: uniqueness stops a duplicate row but cannot distinguish a _retry_ of an assignment from a _deliberate reassignment_ of the same cell, and does not make the multi-row template application idempotent. The two are complementary, not alternatives. |

## Implementation Order

Each step is test-first and, where user-facing, lands web and mobile together.

1. **Prerequisite (recipe service, same owner)** — additive `POST /api/v1/recipes/nutrition-batch` on the recipe service, with tests. Blocks step 5.
2. **`@kitchensink/meal-plan-core`** — pure domain: ids, value objects, access policy, rollup, template projection,
   grocery projection, database-name leaf module. All unit + property tests; no I/O anywhere.
3. **Service skeleton + schema** — workspace, Zod config, auth middleware, one error filter, Drizzle schema +
   migrations, health. Integration tests against Docker Postgres.
4. **Plans and entries CRUD** — repositories, services, controllers, idempotency, keyset pagination, ownership scoping.
5. **Nutrition** — `RecipeGateway` (availability-disciplined) + `plan-nutrition.service.ts` wiring the pure fold.
6. **Templates** — save-as-template and apply, with the skip report.
7. **Grocery projection + erasure participation** — FR-036, FR-039.
8. **Typed client** — `@kitchensink/meal-plan-service-client` with TanStack queries, fixtures and `testing/` helpers.
9. **Planner UI** — `@commise/features-meal-plan`: headless hook, pure components, web board (`@dnd-kit` + keyboard),
   mobile board (tap-to-assign), creation flow, nutrition summary, i18n messages. Component tests per state on both.
10. **Home widget + roadmap retirement** — register the live descriptor, delete the `meal-plan` roadmap spec entry and
    both app skeletons in the same change (FR-035).
11. **App wiring** — web `/[locale]/meal-plan` route, mobile screen + nav item, Playwright and Maestro flows.
12. **Infra + CI** — CDK stack, listener rule at priority 400, DB bootstrap, `deploy-meal-plan` job with the
    ensure-exists gate and ecosystem smoke, k6 profiles.

**Phase 2 (not scheduled)** — FR-025/026/027, unblocked only when 005 provides the AI surface and 010 provides an
enforceable entitlement.
