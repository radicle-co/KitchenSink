# Coding Standards

Tactical conventions for the KitchenSink monorepo. This document is the authoritative
reference for day-to-day coding decisions. The [Constitution](../.specify/memory/constitution.md)
defines immutable principles; this document translates them into enforceable rules.

**Version**: 1.5.0 | **Created**: 2026-04-19 | **Last Updated**: 2026-08-12

> **1.5.0** — **§15.5 added**, making §15.2/§15.4 binding on code that does not exist yet and deciding the
> **failure** side of the boundary parse. A new service owes its authored zod, `contract:generate`, a committed
> schema package with a derived `openapi.yaml`, a `CONTRACT_HASH` boot assertion, **`nestjs-zod`'s**
> `ZodValidationPipe`, `z.strictObject()` and validated non-HTTP ingress **from its first commit**; a new client
> owes zero wire types, receipt validation, outbound validation against the callee's zod, and a contract-skew
> guard. Every conformance gate must **discover** its subjects from the filesystem — a hardcoded list is the
> defect. **§15.5.2 closes GR-016 OPEN-GR-016-B** (`z.strictObject()` is the default for mutating bodies) and
> **§15.5.3 closes OPEN-GR-016-A** (the storage floor is a per-service parity test — and the mechanism,
> `@kitchensink/contract-gen`'s `auditStorageCapacity`, is **already wired in all three services**, exhaustive
> over bounded columns in both directions).
> **§15.5.4**: one rejection path, one shape, one `reason`, one counter, one alarm — with the response **status
> derived from the `reason` by a single complete lookup**, because "would a redelivery ever succeed?" genuinely
> differs: a **shape** failure behind a valid signature answers **`2xx`** (svix/Stripe retry on any non-2xx, and
> a body that cannot parse never will), while a **signature** failure answers **non-2xx** (it may be OUR stale
> secret, and the sender's retry is the recovery — answering `2xx` there discarded a real `user.created` once
> already). A rejected event is never written as a row. **§15.5.5**: no sentinel identifiers, id required
> except on create/upsert. **§15.5.6**: where two principals are asserted, require both and reject on mismatch.
> Also corrected §15.4(5), which still described the `strictObject` default as OPEN. Portfolio rules: GR-017 –
> GR-020.

> **1.4.0** — **§15.4 Input validation** added: one boundary parse per service against the service's own
> authored zod (one mechanism, one `400` path), extended to queue/event consumers and webhooks (a signature
> proves origin, not shape), with the **database schema as the validation FLOOR** — asserted, never derived
> from drizzle. Records the `createZodDto`-under-Nest's-own-`ValidationPipe` trap, `z.object` vs
> `z.strictObject`, the `sql.raw()` prohibition, and the **deliberate deferral of response validation**.
> Portfolio rule: `specs/governance-rules.md` GR-016. (§15 itself landed 2026-08-11 without a version bump.)

> **1.3.0** — corrected §1a/§1b test-file rows and rewrote §7 Test File Location against the actual repo
> layout (both regimes, the reserved `.spec` suffix, Maestro/k6 homes). 61 test files were migrated to the
> single vitest `.test.ts` suffix on 2026-08-02, so the suffix rule now holds repo-wide; the integration
> **directory** stays a SHOULD because two shapes legitimately coexist. Also corrected §4 Extensions,
> which prescribed a relative-import extension the compiler rejects (`error TS5097`).

---

## 1. File Naming

> **Enforced, not advisory.** File names are checked in CI by `eslint-plugin-check-file` per package
> (see `packages/tools/eslint`). A non-conforming name FAILS lint — this is the guardrail that keeps the
> convention from drifting. There are **two regimes**, because the backend and frontend follow different
> ecosystem norms; pick by the package the file lives in.

### 1a. Backend services — NestJS packages (`packages/services/*`)

Follow the **NestJS `name.type.ts` convention**: a **kebab-case** name plus a dot-separated role suffix,
for **every** file (services, controllers, filters, guards, decorators, modules, DALs, DTOs, and plain
domain/utility modules) — regardless of whether the file exports a class. This is the framework-idiomatic
convention the entire backend uses (e.g. `recipes.service.ts` exports `RecipesService`).

| Context                 | Convention                               | Example                                                                  |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Provider / injectable   | `<name>.<role>.ts` (kebab)               | `recipes.service.ts`, `clerk-auth.service.ts`, `api-exception.filter.ts` |
| Domain / utility module | kebab-case `.ts`                         | `recipe-visibility.ts`, `pool-config.ts`                                 |
| Unit test               | `<source>.test.ts` in `__tests__/`       | `recipes.service.test.ts`                                                |
| Integration test        | `<name>.integration.test.ts` in `tests/` | `create-user-flow.integration.test.ts`                                   |
| E2E test                | `<name>.e2e.test.ts` in `tests/e2e/`     | `users-validation.e2e.test.ts`                                           |

Directories and the reason `.test` (not `.spec`) is the vitest suffix are in
[§7 Test File Location](#test-file-location). Integration and E2E tests are wired into their own
vitest configs and MUST NOT run in the default `test` task.

### 1b. Frontend & shared libraries (`packages/apps/*`, `packages/shared/*`, `packages/clients/*`, `packages/utils/*`)

Kebab is **not** allowed here — use camelCase for modules, PascalCase for a file that exports a React
component or a class (name matching the export).

| Context                             | Convention                                                  | Example                                             |
| ----------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| Module / util / hook / type / const | `camelCase.ts`                                              | `authState.ts`, `useUserProfile.ts`, `apiClient.ts` |
| React component                     | `PascalCase.tsx`                                            | `RecipeCard.tsx`, `AccountStateGate.tsx`            |
| Non-component class                 | `PascalCase.ts`                                             | `RecipeRepository.ts`                               |
| Mobile (Expo/RN) variant            | `<source>.native.ts(x)`                                     | `RecipeCard.native.tsx`, `storage.native.ts`        |
| Unit / component test               | `<source>.test.ts(x)`                                       | `authState.test.ts`, `RecipeCard.test.tsx`          |
| Integration test                    | `<name>.integration.test.ts(x)` in `tests/__integration__/` | `tailwindTheme.integration.test.ts`                 |
| E2E (Playwright)                    | `<feature>.spec.ts` in `tests/e2e/`                         | `signIn.spec.ts`                                    |

**Framework-mandated exceptions (allowed, not renameable):** Next.js special files
(`page.tsx`, `layout.tsx`, `route.ts`, `not-found.tsx`, `global-error.tsx`, `middleware.ts`,
`instrumentation-client.ts`, `next-env.d.ts`) and Expo Router route files keep the names those frameworks
require. The lint config exempts them explicitly.

### Rules (both regimes)

- One class or component per file. No exceptions.
- The filename matches the exported class/component name (kebab-cased for backend, PascalCase for frontend).
- Barrel `index.ts` files MUST contain only named re-exports. No logic, no side effects.
- The `.mobile.ts` / `.mobile.tsx` suffix is **prohibited**. Use `.native.ts(x)` —
  see [§14 Cross-Platform File Conventions](#14-cross-platform-file-conventions).

---

## 2. Function Purity

Functions MUST be pure unless they perform I/O, mutations, or external calls.
This is not a preference — it is a requirement. Violations MUST be caught in code review.

```typescript
// Good — pure function
function calculateNutrition(ingredients: Ingredient[]): NutritionSummary {
    return ingredients.reduce(
        (totals, item) => ({
            calories: totals.calories + item.calories,
            protein: totals.protein + item.protein,
        }),
        { calories: 0, protein: 0 },
    );
}

// Bad — side effect (mutates external state)
let totalCalories = 0;
function addCalories(ingredient: Ingredient): void {
    totalCalories += ingredient.calories;
}
```

### Impure Function Isolation

When side effects are necessary (I/O, database, external APIs), isolate them and
document with a `@sideEffect` JSDoc tag:

```typescript
/**
 * Uploads a recipe photo to the CDN.
 *
 * @param recipeId - The recipe to attach the photo to.
 * @param file - The image file buffer.
 * @returns The public URL of the uploaded photo.
 * @sideEffect Writes to S3 via the CDN upload API.
 */
async function uploadRecipePhoto(recipeId: string, file: Buffer): Promise<string> {
    // implementation
}
```

Push side effects to the boundary of the call stack (handlers, controllers, entry points).
Compose pure functions for all transformations and business logic.

---

## 3. Folder Structure

Organize by feature domain, not by generic type.

```
src/
  recipes/              # Feature domain
    recipeService.ts
    recipeService.test.ts
    parseIngredient.ts
    RecipeCard.tsx
    types.ts
    index.ts            # Barrel: re-exports only
  ingredients/
    ...
  photos/
    ...
  common/               # Cross-cutting utilities (not "lib/" or "helpers/")
    ...
  dal/                  # Server-only data access layer
    ...
```

### Rules

- `helpers/` directories are banned. Use `utils/` co-located with consumers, or `common/`
  for cross-cutting concerns.
- `lib/` is reserved for third-party library wrappers only.
- Component folders follow: `ComponentName.tsx`, `types.ts`, `styles.ts`, `index.ts`, `__tests__/`.

### Utility Placement

Utility and helper functions must live in a `utils/` directory co-located with the
source code that uses them. Group related helpers into descriptive files by domain.

```
src/recipes/
├── recipeService.ts
├── routes/
│   ├── createRecipe.ts
│   └── searchRecipes.ts
└── utils/
    ├── response.ts       → jsonResponse, errorResponse
    ├── validation.ts     → type guards, request parsers
    └── nutrition.ts      → calorie calculations, unit conversions
```

Guidelines:

- **Deduplicate**: If two or more files share the same helper, extract it to `utils/`.
  Never duplicate a helper across files.
- **Group by domain**: Put related helpers in one file (e.g., all response builders
  in `response.ts`, all type guards in `validation.ts`).
- **Single-use helpers**: If a helper is only used by one file and is small (under ~15 lines),
  keep it in that file. Extract it when it grows or gains a second consumer.
- **Pure functions preferred**: Utility functions should be pure when possible. If a util
  needs side effects, document it with `@sideEffect`.
- **Export explicitly**: Only export helpers used outside the file. Keep internal-only
  helpers unexported.

```typescript
// Good — deduplicated in utils/response.ts
import { jsonResponse, errorResponse } from '@/utils/response.js';

// Bad — duplicated across route files
function jsonResponse(statusCode: number, payload: unknown): ApiResponse { ... }
// (same function copy-pasted in another file)
```

---

## 4. Import Conventions

### Order

1. External packages (`react`, `@nestjs/common`, `sharp`)
2. Aliased internal imports (`@kitchensink/*`, `@kitchensink/*`, `@kitchensink/<pkg>`)

Blank line between groups. No other grouping required.

### Extensions

The extension follows the package's `moduleResolution`, which is not a matter of taste — the compiler
rejects the alternative.

| Regime                                                                                                | Aliased imports | Relative imports |
| ----------------------------------------------------------------------------------------------------- | --------------- | ---------------- |
| `NodeNext` — backend services, clients, shared libs (the `@kitchensink/typescript/base.json` default) | `.js` / `.jsx`  | `.js` / `.jsx`   |
| `bundler` — `@commise/web` (Next.js)                                                                  | `.js` / `.jsx`  | extensionless    |

**A relative import MUST NEVER end in `.ts` / `.tsx`.** Under `NodeNext` that is `error TS5097`
("An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled"),
which the base config does not set. There are zero first-party relative `.ts` imports in the repo, and
653 of 653 relative imports in `recipe-service` use `.js`.

```typescript
// Good — external, then aliased, blank line between groups
import { describe, it, expect } from 'vitest';

import type { Recipe } from '@kitchensink/recipe-core';
import { makeRecipe } from '@/e2e/__fixtures__/makeRecipe.js';

// Good — relative import inside a NodeNext package
import { RecipeServiceClient } from '../index.js';

// Good — relative import inside the web app (bundler resolution)
import { RecipeCard } from './RecipeCard';

// Bad — .ts on a relative import: error TS5097 under NodeNext
import { makeRecipe } from '../__fixtures__/recipes.ts';

// Bad — relative import crossing workspace boundaries (use an alias)
import type { Recipe } from '../../../shared/recipe-core/src/index.js';
```

### Aliases

Every workspace MUST use path aliases. Direct relative imports crossing workspace
boundaries are prohibited. Aliases follow the `@<workspace>/*` pattern.

Exception: `e2e/`, `__fixtures__/`, and `__testing__/` directories where no alias exists.

### React Imports

Use named imports from `react`, never namespace imports. Import only the hooks, types,
and utilities you need.

```typescript
// Good — named imports
import { useState, useEffect, useCallback } from 'react';
import type { ReactElement, ComponentPropsWithRef } from 'react';

// Bad — namespace import
import * as React from 'react';
```

### Type-Only Imports

Use `import type { X }` when importing only types. This enables tree-shaking and
makes the import's purpose explicit.

```typescript
// Good — type-only import
import type { Recipe } from '@kitchensink/models';
import type { DatabaseAdapter } from '@kitchensink/data';

// Good — mixed import (values + types)
import { RecipeStatus } from '@kitchensink/models';
import { parseIngredient, type IngredientInput } from '@kitchensink/core';

// Bad — importing types without 'type' keyword
import { Recipe } from '@kitchensink/models';
```

---

## 5. Naming Conventions

| Construct                         | Convention                                                              | Example                                 |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| Variables, functions, parameters  | `camelCase`                                                             | `getRecipeById`, `ingredientCount`      |
| Classes, interfaces, type aliases | `PascalCase`                                                            | `RecipeService`, `IngredientInput`      |
| Constants (module-level)          | `UPPER_SNAKE_CASE` or `camelCase`                                       | `MAX_UPLOAD_SIZE`, `defaultConfig`      |
| Enums                             | `PascalCase` (name), `PascalCase` (members)                             | `RecipeStatus.Draft`, `Cuisine.Italian` |
| Interface vs Type                 | `interface` for data shapes/contracts; `type` for unions/aliases/mapped | —                                       |
| Unused parameters                 | Prefix with `_`                                                         | `_unusedParam`                          |
| Boolean variables/props           | Prefix with `is`, `has`, `should`, `can`                                | `isLoading`, `hasError`                 |
| Event handlers                    | Prefix with `on` (prop) or `handle` (implementation)                    | `onClick`, `handleSubmit`               |

### 5.1 Package & workspace naming — the platform/product split

Two publish scopes, split by **platform vs. product**:

- **`@kitchensink/*` — the KitchenSink _platform_.** Reusable backend + tooling: everything under `packages/{services,clients,shared,tools,infra,utils}/*`. The existing style is kept (role suffixes are fine): `@kitchensink/food-service`, `@kitchensink/food-service-client`, `@kitchensink/clerk-verify`, `@kitchensink/infra-global`, `@kitchensink/eslint`.
- **`@commise/*` — the Commise _product_.** Everything under `packages/apps/commise/`: the apps (`@commise/web`, `@commise/mobile`, `@commise/ui`) and the feature packages under `packages/apps/commise/features/*` — `@commise/features-<name>` (e.g. `@commise/features-recipes`, `@commise/features-core`, both introduced by feature 001).

**Rule of thumb: if it lives under `packages/apps/commise/`, it's `@commise/*`; otherwise it's `@kitchensink/*`.** A domain's _backend_ (service/client/types) is platform, while its Commise _widget / feature UI_ is product — e.g. feature 001 adds the recipe backend as `@kitchensink/recipe-service` (alongside today's `@kitchensink/food-service`) and its Home widget as `@commise/features-recipes`. CDK stack/resource names (`kitchensink-*`) are a separate namespace and are **not** governed by this rule.

---

## 6. TypeScript Rules

- Strict mode always. Zero `any` outside test doubles.
- No `@ts-ignore`, `@ts-expect-error`, or `as any` — ever.
- Prefer `const` enums and string literal unions over raw strings/numbers.

### `interface` vs `type`

Use `interface` for data shapes and contracts. Use `type` for unions, aliases, and mapped types.

```typescript
// Good — interface for data shapes
export interface Recipe {
    id: string;
    title: string;
    ingredients: Ingredient[];
    createdAt: string;
}

// Good — type for unions and aliases
export type Cuisine = 'Italian' | 'Mexican' | 'Japanese' | 'Indian';
export type RecipeField = keyof Recipe;
export type SortDirection = 'asc' | 'desc';
```

### Custom Errors

Custom errors MUST extend `Error` with a corresponding `is*` type guard.
Always call `Object.setPrototypeOf` in the constructor to ensure `instanceof`
works correctly across module boundaries.

```typescript
export class RecipeNotFoundError extends Error {
    readonly recipeId: string;

    constructor(recipeId: string) {
        super(`Recipe not found: ${recipeId}`);
        this.name = 'RecipeNotFoundError';
        this.recipeId = recipeId;
        Object.setPrototypeOf(this, RecipeNotFoundError.prototype);
    }
}

export function isRecipeNotFoundError(error: unknown): error is RecipeNotFoundError {
    return error instanceof RecipeNotFoundError;
}
```

### Type Guards

Name type guard functions with an `is` prefix. Return type must use `x is T` predicate syntax.
Provide a type guard for every custom error class and every discriminated union.

```typescript
export function isPublishedRecipe(recipe: Recipe): recipe is PublishedRecipe {
    return recipe.status === 'published' && recipe.publishedAt !== undefined;
}
```

### Date Representation

Use ISO 8601 strings (`string` type) for dates in interfaces, never `Date` objects.
This ensures serialization compatibility across all platforms and storage backends.

```typescript
// Good — ISO 8601 string
export interface Recipe {
    /** When this recipe was created. ISO 8601 */
    createdAt: string;
    /** When this recipe was last updated. ISO 8601 */
    updatedAt: string;
}

// Bad — Date objects (not serializable)
export interface Recipe {
    createdAt: Date;
    updatedAt: Date;
}
```

### Unused Parameters

Prefix unused parameters with `_` to satisfy the linter. Do not delete required
parameters to avoid breaking function signatures.

```typescript
// Good — unused parameter prefixed with _
export function registerIngredient(name: string, _metadata: unknown): void {
    ingredientRegistry.set(name, _metadata);
}
```

---

## 7. Testing Conventions

- Test pyramid: >= 70% unit, <= 20% integration, <= 10% E2E.
- Every test file opens with a block comment mapping requirement IDs to test descriptions.
- Global registries MUST be cleared in `beforeEach`.

### 7.1 Test Mandate — ABSOLUTE, NON-NEGOTIABLE (every phase, every feature, every contributor)

**This is the single highest-priority rule in this document. It is NOT a guideline, NOT a "best effort", and NOT subject to judgment calls.** Tests are written **BEFORE** the code they cover — TDD red → green — with **ZERO EXCEPTIONS**. Code that lacks the tests its category requires below is, by definition, **INCOMPLETE**: it **MUST NOT** be merged, **MUST NOT** be marked "done", and **MUST NOT** be called shippable — regardless of deadline, scope, or author (human **or** AI agent). The following are all **VIOLATIONS**, not acceptable trade-offs: "I'll add tests later", "the happy path is enough", "it's just a small change", "the test can't run in my environment so I skipped it", and thinning, deferring, downgrading, or omitting **any** required test tier.

This applies to **EVERY** phase, **EVERY** feature, and **EVERY** change to this repository — permanently.

| Work under test                                                                                  | REQUIRED tests — write **ALL** of them, test-first. Omitting **any one** = the work is INCOMPLETE.                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UI code** (components, screens, hooks)                                                         | (1) a **vitest component test** (React Testing Library) for **EVERY** UI path/state — loading, empty, populated, error, gated, disabled, and every other branch — **NOT just the happy path, NOT a representative sample; every single path**; **AND** (2) a **Playwright** test (web) for **EVERY** happy-path / user story — Playwright **IS** the UI's integration test. Mobile parity: a **Maestro** flow per story. |
| **Non-UI code** (services, DALs, domain logic, controllers, DTOs, workers, libraries, utilities) | **unit tests AND integration tests — BOTH, always.** Integration exercises the **real** dependency (Docker Postgres for the DB, LocalStack for AWS). A unit test alone is a **VIOLATION**.                                                                                                                                                                                                                               |
| **Services** (deployable HTTP APIs)                                                              | everything above **PLUS end-to-end tests** (boot the service against real Postgres + LocalStack and drive it over HTTP) **AND k6 load/performance tests** (assert the service's latency/throughput SLOs). Unit + integration alone is **NOT SUFFICIENT** for a deployable API.                                                                                                                                           |

**Absolute rules — no interpretation, no exceptions:**

- **EVERY UI path/state gets a vitest component test.** Every branch, every state. Not a sample, not the happy path only — every one.
- **EVERY happy-path / user story gets a Playwright (web) AND a Maestro (mobile) test.**
- **EVERY non-UI unit gets BOTH a unit test AND an integration test.** Never one without the other.
- **EVERY service additionally gets e2e AND k6 tests**, on top of unit + integration.
- A feature is **NOT DONE** — not "done pending tests", not "done except CI", not "done, tests to follow" — until **every** category it touches has **passing** tests of **every** required kind.
- This is a **HARD MERGE GATE.** A change that adds or modifies code without its required tests is incomplete by definition and **MUST be rejected in review**.
- **"It can't run in this environment" is NEVER an excuse to omit a test.** If a required test cannot execute locally (e.g. no Docker), it is still **written** and **run in CI** — a missing test file is a violation; a written-but-CI-only test is fine.
- The `>= 70% unit / <= 20% integration / <= 10% E2E` pyramid still holds; **k6 is a separate, additional performance gate**, not part of the pyramid.

### Test File Location

Two regimes, matching the [§1 File Naming](#1-file-naming) split. Pick by the package the test lives in.

#### Backend services & clients (`packages/services/*`, `packages/clients/*`)

| Tier        | Location                            | Name                    | Wired by                       |
| ----------- | ----------------------------------- | ----------------------- | ------------------------------ |
| Unit        | `__tests__/` co-located with source | `*.test.ts`             | `vitest.config.ts`             |
| Integration | `tests/`                            | `*.integration.test.ts` | `vitest.integration.config.ts` |
| E2E         | `tests/e2e/`                        | `*.e2e.test.ts`         | `vitest.e2e.config.ts`         |

#### Frontend & shared libraries (`packages/apps/*`, `packages/shared/*`)

| Tier                  | Location                             | Name                       | Wired by                       |
| --------------------- | ------------------------------------ | -------------------------- | ------------------------------ |
| Unit / component      | `__tests__/` co-located, or `tests/` | `*.test.ts(x)`             | `vitest.config.ts`             |
| Integration           | `tests/__integration__/`             | `*.integration.test.ts(x)` | `vitest.integration.config.ts` |
| E2E (Playwright, web) | `tests/e2e/`                         | `*.spec.ts`                | `playwright.config.ts`         |
| E2E (Maestro, mobile) | `.maestro/`                          | `*.yaml`                   | `run-maestro-flows.sh`         |

#### Every regime

- **Load / performance (k6)**: `packages/tools/loadtest/` — scripts are shared across services, not
  colocated per package. Required for every deployable service ([§7.1](#71-test-mandate--absolute-non-negotiable-every-phase-every-feature-every-contributor)).
- **Mocks**: `__mocks__/` directories co-located with source.
- **Fixtures**: `__fixtures__/` directories co-located with tests.

#### `.test.ts` vs `.spec.ts` — the suffix is reserved, not stylistic

**Bare `*.spec.ts` means Playwright and nothing else.** Every vitest tier — unit, integration, E2E —
uses a `.test.ts` suffix. This is not a preference: Playwright's default `testMatch` also collects
`*.test.ts`, so a shared suffix makes it try to run vitest files as browser specs and crash the run on
their `vitest` imports. `packages/apps/commise/web/playwright.config.ts` pins `testMatch: '**/*.spec.ts'`
for exactly this reason. Keeping the two suffixes disjoint is what stops the collision from recurring.

#### Integration and E2E MUST NOT run in the default `test` task

Per [Constitution Principle IV](../.specify/memory/constitution.md#iv-testing-discipline-with-pyramid-enforcement),
each tier gets its own vitest config and its own `package.json` script (`test:integration`, `test:e2e`),
and the default `test` include globs MUST exclude the other tiers' patterns. A package that adds an
integration or E2E tier MUST also be added to the corresponding CI job — CI invokes these per-workspace
by name (`.github/workflows/_ci.yml`), so a new script that no job calls is a test that never runs.

#### Suffix is a hard rule; the integration directory is a SHOULD

The **suffix** table above is mandatory — it is what keeps vitest and Playwright from colliding, and every
package now conforms (61 files were migrated to it on 2026-08-02).

The integration **directory** is deliberately a SHOULD, because the repo genuinely runs two shapes and
neither is wrong:

| Layout                       | Packages                                     |
| ---------------------------- | -------------------------------------------- |
| `tests/` (preferred for new) | `identity`, `food-service`, `@commise/web`\* |
| `__tests__/integration/`     | `recipe-service`, `recipe-workers`           |
| `src/__integration__/`       | `recipe-service-client`                      |

\* web uses `tests/__integration__/` per the frontend regime.

New packages SHOULD use `tests/` (it matches the `tests/e2e/` layout that all six service packages already
share). Relocating the existing suites would rewrite import depths across ~45 files for zero functional
gain, so it is explicitly **not** required. What IS required, in every layout: the tier has its own
`vitest.integration.config.ts`, its own script, an exclude that keeps it out of the default `test` glob,
and a CI job that calls it.

### Test Structure

- Top-level `describe` for the module or class under test
- Nested `describe` per method or feature
- `it` for individual behaviors — describe what should happen, not how

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('RecipeService', () => {
    describe('getById', () => {
        it('returns the recipe when it exists', () => { ... });
        it('throws RecipeNotFoundError when recipe does not exist', () => { ... });
    });

    describe('search', () => {
        it('filters recipes by cuisine', () => { ... });
        it('returns empty array when no recipes match', () => { ... });
    });
});
```

### Test Imports

Always explicitly import test functions from `vitest`, even though globals are enabled.

```typescript
// Good — explicit imports
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Avoid — relying on globals
describe('test', () => { ... }); // works but implicit
```

### Fixture Factories

Create `make*` functions in `__fixtures__/` that accept `Partial<T>` overrides and
return a complete object with sensible defaults.

```typescript
// __fixtures__/makeRecipe.ts
import type { Recipe } from '@kitchensink/models';

/** Creates a minimal Recipe fixture. */
export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: 'recipe-1',
        title: 'Classic Margherita Pizza',
        cuisine: 'Italian',
        servings: 4,
        ingredients: [],
        instructions: [],
        createdAt: '2026-01-15T12:00:00Z',
        updatedAt: '2026-01-15T12:00:00Z',
        ...overrides,
    };
}
```

### Registry Isolation

When testing code that uses global registries, call the registry's `clear*` function
in `beforeEach` to prevent cross-test pollution.

```typescript
import { clearIngredientRegistry } from '@kitchensink/core';

describe('ingredient registry', () => {
    beforeEach(() => {
        clearIngredientRegistry();
    });

    it('registers an ingredient by name', () => { ... });
});
```

### Accessible Selectors Only

Playwright selectors: `getByRole` and `getByLabel` only. `data-testid` is banned.
`page.waitForTimeout()` is banned. Use `waitForURL`, `waitForSelector`, or
`expect(locator).toBeVisible()`.

```typescript
// Good — accessible selectors
const submitButton = page.getByRole('button', { name: /save recipe/i });
const titleInput = page.getByLabel('Recipe title');

// Bad — data-testid (FORBIDDEN)
const submitButton = page.locator('[data-testid="submit-button"]');
```

This rule applies to all testing layers: unit tests (Testing Library), E2E tests
(Playwright), and component tests.

---

## 8. Documentation

- Every exported symbol MUST have a JSDoc block.
- Every source file MUST open with a module-level JSDoc summary.
- Non-trivial functions: `@param`, `@returns`, `@throws` tags required.
- Impure functions: `@sideEffect` tag required.
- Inline comments explain _why_, never _what_.

### Function Comments

```typescript
// Good — detailed JSDoc with params, returns, and throws
/**
 * Searches recipes by ingredient name and optional cuisine filter.
 *
 * Queries the recipe index using full-text search on ingredient names.
 * Returns results sorted by relevance score descending.
 *
 * @param ingredientName - The ingredient to search for.
 * @param cuisine - Optional cuisine filter.
 * @returns Matching recipes sorted by relevance.
 * @throws SearchIndexError if the search index is unavailable.
 */
async function searchByIngredient(ingredientName: string, cuisine?: Cuisine): Promise<Recipe[]> {
    // implementation
}

// Good — simple function, single-line JSDoc is sufficient
/** Returns the display name combining quantity and unit. */
function formatQuantity(quantity: number, unit: string): string {
    return `${quantity} ${unit}`;
}
```

### Interface and Type Comments

```typescript
// Good — every field documented
/**
 * Input for creating a new recipe.
 */
export interface CreateRecipeInput {
    /** The recipe title. Must be 3-200 characters. */
    title: string;

    /** The primary cuisine classification. */
    cuisine: Cuisine;

    /** Number of servings this recipe yields. Must be >= 1. */
    servings: number;
}

// Bad — no field comments
export interface CreateRecipeInput {
    title: string;
    cuisine: Cuisine;
    servings: number;
}
```

### Inline Comments

Use inline comments sparingly for non-obvious logic. Do not comment obvious code.

```typescript
// Good — explains non-obvious business rule
// DynamoDB does not support empty strings, so we store null for empty optional fields
export const recipes = defineTable({
    description: attribute('S').optional(),
});

// Bad — states the obvious
// Create a new date
const now = new Date();
```

### Module-Level File Headers

Each source file should have a top-level JSDoc block summarizing what the module does.

```typescript
/**
 * Recipe search service using OpenSearch for full-text ingredient matching.
 * Supports cuisine filtering and relevance-based ranking.
 */
```

---

## 9. Formatting (Enforced by Tooling)

All formatting is enforced by Prettier and ESLint. These are not discretionary:

- 4-space indentation, spaces (not tabs)
- Semicolons always
- Trailing commas everywhere
- Single quotes
- 120-character print width
- Braces required for all control structures (even single-statement bodies)
- Blank line after block statements and before `return`

### Blank Lines After Blocks

```typescript
// Good — visual breathing room
const title = getTitle();
const servings = getServings();

if (servings < 1) {
    throw new Error('Servings must be at least 1');
}

const result = createRecipe(title, servings);

return result;

// Bad — no breathing room
const title = getTitle();
const servings = getServings();
if (servings < 1) {
    throw new Error('Servings must be at least 1');
}
const result = createRecipe(title, servings);
return result;
```

---

## 10. Exports

- Named exports exclusively.
- Default exports only where framework-mandated: Next.js `page.tsx`/`layout.tsx`, Expo entry.
- React components MUST NOT use boolean flag props to switch between fundamentally
  different render trees. Use composition via parent instead.

```typescript
// Good — named export
export function createRecipeService(db: DatabaseAdapter): RecipeService { ... }
export class ImageProcessor { ... }

// Bad — default export (unless framework-required)
export default function createRecipeService() { ... }
```

### Barrel Files (`index.ts`)

Use barrel files at module boundaries to define the public API. Separate type-only
exports from value exports.

```typescript
// src/recipes/index.ts
export { RecipeService } from './RecipeService.js';
export { parseIngredient } from './parseIngredient.js';
export type { Recipe, Ingredient, CreateRecipeInput } from './types.js';
```

Use `// === Section Name ===` separators for logical groupings in larger barrel files:

```typescript
// === Core Exports ===

export { RecipeService } from './RecipeService.js';
export { IngredientParser } from './IngredientParser.js';

// === Types ===

export type { Recipe, Ingredient } from './types.js';
```

---

## 11. React Components

### No Boolean Flag Props

Never use boolean props to switch between fundamentally different component behaviors
or render trees. A boolean flag that causes a component to render entirely different
content is a composition failure.

```tsx
// Bad — flag switches between entirely different components
function RecipeView({ isOwner, ...rest }: Props): ReactElement {
    if (isOwner) {
        return <RecipeEditor {...rest} />;
    }

    return <RecipeReadOnly {...rest} />;
}

// Good — parent composes the correct child directly
function RecipeContainer({ recipe, currentUserId }: Props): ReactElement {
    if (recipe.ownerId === currentUserId) {
        return <RecipeEditor recipe={recipe} />;
    }

    return <RecipeReadOnly recipe={recipe} />;
}
```

**Legitimate boolean props** (NOT violations):

- `isLoading` — toggles a skeleton/spinner within the same component layout
- `disabled` — standard HTML semantics
- `isOpen` / `isExpanded` — toggle visibility of content within a single component

The test: if removing the boolean would split the component into two, it should be
two components composed by the parent.

---

## 12. Environment Variables

Access environment variables using bracket notation, not dot notation.

```typescript
// Good — bracket notation
const apiKey = process.env['RECIPE_API_KEY'];
const dsn = process.env['SENTRY_DSN'];

// Bad — dot notation
const apiKey = process.env.RECIPE_API_KEY;
```

---

## 13. Error Handling

Use typed error classes with corresponding type guards:

```typescript
import { RecipeNotFoundError, isRecipeNotFoundError } from '@kitchensink/models';

try {
    await recipeService.getById(recipeId);
} catch (error) {
    if (isRecipeNotFoundError(error)) {
        return notFoundResponse(error.recipeId);
    }

    throw error;
}
```

Never use empty catch blocks. Every `catch` must either handle the error meaningfully
or re-throw it.

---

## 14. Cross-Platform File Conventions

Implements [Constitution Principle VIII](../.specify/memory/constitution.md#viii-cross-platform-parity-and-code-sharing).
Web (Next.js) and mobile (Expo) are first-class peers — these rules are mandatory
and enforced in code review.

### 14.1 Lockstep Parity (Hard Rule)

- Every user-facing feature MUST ship to **both** web and mobile in the same release.
- A PR introducing a user-facing capability MUST include both web and mobile
  implementations, or it MUST NOT be merged.
- `tasks.md` for any user-facing requirement MUST contain paired web + mobile
  tasks. Reviewers MUST reject task lists missing the mobile counterpart.
- Single-platform rollouts require an explicit waiver recorded in the feature's
  `plan.md` Complexity Tracking table and approved in the PR description.

### 14.2 Shared-Code-First (Hard Rule)

All reasonable attempts MUST be made to share code across platforms. The default
location for new code is a shared workspace; per-platform code is the exception.

| Code type                                | Default location                      | Allowed to fork per platform? |
| ---------------------------------------- | ------------------------------------- | ----------------------------- |
| Domain types, models, validation schemas | `packages/models` (or shared package) | No                            |
| Business logic, pure utilities           | shared package                        | No                            |
| API clients, hooks, query definitions    | shared package                        | No (transport may fork)       |
| State management (stores, reducers)      | shared package                        | No                            |
| UI primitives & design-system tokens     | shared package                        | Render layer only (see §14.3) |
| Screen / page composition                | per-app                               | Yes                           |
| Navigation, routing                      | per-app                               | Yes (Next.js vs Expo Router)  |
| Native-only APIs (haptics, secure store) | `*.native.ts` shim                    | Yes                           |

Duplicating logic across platforms requires a code-review-visible justification
comment (`// PLATFORM-FORK: <reason>`).

### 14.3 The `.native.ts(x)` Suffix (Hard Rule)

When a module genuinely requires a platform-specific implementation, the mobile
variant MUST be colocated with the shared/web file using the `.native.` suffix.

**Canonical convention**: `.native.ts` and `.native.tsx`.
**Prohibited**: `.mobile.ts`, `.mobile.tsx`, `.ios.ts`, `.android.ts`
(unless an iOS- or Android-only fork is unavoidable, in which case Metro's
`.ios.*` / `.android.*` resolution is permitted with a `PLATFORM-FORK` comment).

```
src/recipes/
├── RecipeCard.tsx              # Shared + web implementation
├── RecipeCard.native.tsx       # Mobile-only override (Expo/React Native)
├── storage.ts                  # Web (localStorage) + shared interface
├── storage.native.ts           # Mobile (expo-secure-store) implementation
└── RecipeCard.test.tsx         # One test file covers both via shared logic
```

### 14.4 Resolution & Bundler Rules

- Metro / Expo automatically resolves `Foo.native.tsx` over `Foo.tsx` on mobile.
  Imports MUST use the bare name (`import { RecipeCard } from './RecipeCard'`),
  never `./RecipeCard.native`.
- Web bundlers (Next.js / webpack / Turbopack) MUST NOT bundle `.native.*` files.
  If a web build pulls in a `.native.*` file, the bundler config is broken — fix
  the config, do not rename the file.
- Both files MUST export the **same public API** (identical exported names and
  type signatures). Type checking MUST pass for both with the same consumer code.

### 14.5 Review Checklist

PR reviewers MUST verify:

1. New user-facing feature → both web and mobile changes present.
2. New shared logic → lives in a shared package, not duplicated in `apps/web` and
   `apps/mobile`.
3. Any new `.native.*` file → has a same-named non-native sibling with matching
   public API.
4. No `.mobile.*` files introduced.
5. `tasks.md` (if present) lists paired web + mobile tasks.

---

## 15. API Contracts — the service OWNS its wire types

**The rule:** for every HTTP service in this repo, the **service** is the single authoritative source
of its wire contract. That contract is expressed as an **OpenAPI document generated from the
service's own DTOs**, and every client consumes **types the service owns**. A client package MUST NOT
re-declare a request or response shape it does not own.

### 15.1 Why this is a hard rule, not a preference

A hand-written client type is a **second, independent representation of one piece of knowledge** — the
wire contract — and it is the most expensive kind of duplication this codebase can carry, because the
two copies drift _silently_ and the drift surfaces at the worst possible layer.

Measured on 2026-08-11, before this section existed: `@kitchensink/recipe-service-client` declared 276
lines of types and `@kitchensink/food-service-client` 144, and **neither imported anything from the
service it speaks to**. No service had `@nestjs/swagger` installed; no service emitted OpenAPI. So a
backend change that altered a response shape did not break any consumer's `typecheck` — the client
went on asserting its own beliefs about the server. The only place the mismatch could surface was an
end-to-end run against a live deployment: a **~50-minute Android emulator job** for mobile, or
production.

That is the failure this section exists to make structurally impossible. Contract drift must fail at
**`typecheck`** (~1.6 minutes), not in e2e, and never in production.

> **⚠️ Correction to the paragraph above (2026-08-11), because reading it uncorrected leads you to build
> the wrong thing.** The "neither imported anything from the service" figure is literally true and
> materially misleading. `packages/shared/recipe-core` **already owns the recipe DOMAIN types** —
> `Recipe`, `RecipeDetail`, `CreateRecipeInput`, `PaginatedResponse`, `Collection`, `RecipePhoto`,
> `RecipeVersion` — with runtime **zod** schemas, and it is imported by 78 recipe-service files and 13
> client files. The 276 lines are the **residue**: the endpoint envelopes recipe-core does not cover. So
> the duplication axis is `client types.ts` ↔ the service's own `*.types.ts`/`*-response.dto.ts`
> (~25 pairs), NOT "client vs service" wholesale.
>
> **Therefore: a contract package REUSES recipe-core type-only and never re-declares its types.**
> Re-declaring `Recipe` or `PaginatedResponse` to achieve a literally-dependency-free package would
> manufacture the exact drift this section exists to prevent.

### 15.2 The required shape (owner-approved 2026-08-11)

**Zod is AUTHORED IN THE SERVICE. The schema package is a committed COPY of it.**

```
packages/services/<service>/src/**/*.schema.ts   ← zod authored HERE, beside the
                                                    controller it serves, and used
                                                    directly for request validation
                        │
                        │  copy  (turbo: $TURBO_ROOT$ inputs — NOT dependsOn; see 15.2.5)
                        ▼
packages/schemas/<service>/        @kitchensink/schema-<service>  — GENERATED, committed
├── src/schemas.ts                 the zod, assembled from the service's *.schema.ts
├── src/types.ts                   `z.infer` types
├── src/contract-hash.ts           hash of the service's schema sources
├── src/index.ts                   barrel — named exports only
└── openapi.yaml                   DERIVED from the zod, for oasdiff / docs / integrators
                        │
                        ▼
packages/clients/<service> → web + mobile    (depend on the leaf, never on the service)
```

Two constraints drove this shape, and both are non-negotiable:

- **Authoring lives in the service.** A contributor adding an endpoint must not have to edit a second
  package to describe it — that is how a contract drifts or the practice gets abandoned.
- **The package lives under `packages/schemas/`.** Not nested in the service, not under
  `packages/services/`.

Together they force a copy, and the copy is accepted deliberately. Naming it plainly matters: **the
"generation" of `schemas.ts`/`types.ts` is a file copy**, not a transformation. Zod schemas are runtime
values, so they cannot be derived from themselves; and every package here exports raw `./src/*.ts`
(see `recipe-core`, the recipe client), so there is no bundle-into-`dist` path that would let a build
inline them instead. The alternatives were a client dependency on the service package (drags the server
graph into web and mobile) or moving the package next to the files (rejected — the location is fixed).

⚠️ **THE COPY'S LOAD-BEARING CONSTRAINT — enforce it in code, not by convention.** A `*.schema.ts` file
may import **only `zod` and other `*.schema.ts` files**. A single import of a service internal — a DAL
type, a drizzle schema, a Nest symbol — either breaks the copied package outright or pulls the server
graph into every client. This WILL be violated: `RecipeSearchResponse.facets` already takes its wire type
from `../dal/search.dal.js`, which is this exact leak in shipped code. A lint rule and/or a generate-time
check must fail loudly, naming the file and symbol.

1. **Derivation flows one way: zod → `z.infer` types, and zod → `openapi.yaml`.** Zod is the authored
   source. `openapi.yaml` is a **derived artifact for external consumption** — `oasdiff`, docs,
   integrators — and is **NOT a codegen input**. Deriving types _through_ OpenAPI was rejected: JSON
   Schema cannot express `readonly`, branded types, or template literals, and discriminated unions
   flatten without explicit `oneOf`/`discriminator`, so it would degrade the strong gate (typecheck) to
   serve the weak artifact.

    The schema package is a copy of the service's zod and **depends on the service** in turbo — never the
    reverse. Nothing in the schema package is hand-edited: to change a contract you edit the service's
    `*.schema.ts` and regenerate. The service consumes its own zod for request validation (via
    `nestjs-zod`'s `createZodDto`), so server and clients validate against one authored definition.

2. **The schema package exports BOTH the types and runtime zod schemas.** A consumer gets compile-time
   types and a runtime validator from one place, so a boundary can be checked at both layers without a
   second representation.
3. **It carries no runtime dependency on the service's graph** (no NestJS, no drizzle, no aws-sdk), so a
   client can depend on it without pulling a server in. An `import type` dependency on a shared domain
   package such as `recipe-core` is fine — it erases at compile time.
4. **Every client imports its wire types and zod from the schema package.** `types.ts` in a client holds
   only genuinely client-side types (config, options, its own error shapes) — never a wire shape.
5. **Three drift layers, each catching what the others cannot. All three are required:**
    - **Rebuild (turbo): `inputs`, NOT `dependsOn`.** ⚠️ `schema-<service>#build` `dependsOn`
      `<service>#build` is **unavailable and must not be re-proposed** — `recipe-service` devDepends on
      `recipe-service-client` for its contract test tier, so that edge closes the cycle
      `client → schema → service → client` and turbo rejects the graph. It is also not what the
      requirement needs: the generated files are committed, and `build` only compiles what is on disk, so
      ordering was never the point. `$TURBO_ROOT$`-anchored `inputs` covering
      the service's `*.schema.ts` sources, so content hashing rebuilds the package automatically.
    - **Correctness (CI):** regenerate and fail on any diff against the committed artifacts. This is the
      strong gate — it is what catches generated output that someone hand-edited.
    - **Skew (runtime):** a `CONTRACT_HASH` over the service's `*.schema.ts` sources, embedded in both the service
      and the schema package and asserted equal at service boot. This catches a **deployed** service
      running ahead of a consumer's pinned schema — invisible to both layers above, and the live case for
      mobile, where a released binary cannot be updated in step with a backend deploy.
    - `oasdiff breaking` against the base branch is worth adding, with a known limit stated honestly:
      `@nestjs/swagger` emits **no response schema** for a handler returning an `interface`, so until
      every response type is a decorated class that check is blind to response changes — most of what
      actually breaks a client.
6. **One document per service, and it REPLACES any hand-written predecessor.** A generated document added
   alongside a hand-maintained one makes the problem worse.
    - `specs/001-commise-recipe-app/contracts/api.openapi.yaml` — 2810 hand-written lines that **57
      source files cite as their authority**, verified by nothing — is **superseded** by recipe's
      generated document. Citations get repointed; the old file is marked superseded. Two documents both
      claiming to be normative is the state this section exists to end.

> **Superseded design note.** An earlier draft of §15.2 put the contract in `packages/contracts/<service>`
> and linked it to the DTOs with `implements` (contract owns the type, DTO owns the validation). That was
> replaced by the owner-approved shape above, which generates types **and zod** and points the turbo
> dependency schema → service. The `implements` draft's one durable finding still applies as a hazard to
> handle, not a reason to deviate: codegen cannot express a discriminated union (`IngredientSuggestion`)
> or an intersection (`Collection`) from a decorated class without explicit `oneOf`/`discriminator`
> handling. Handle those explicitly — a generated schema that silently flattens them to `object` is a
> contract that lies, which is worse than no contract.

### 15.3 Third-party APIs are the OPPOSITE case — do not "converge" them

For an API we do **not** own (USDA FoodData Central, Clerk, Vercel), there is no service of ours to own
the type, and the upstream contract cannot be trusted. Those clients **validate at the boundary with a
runtime schema** (zod) and may legitimately declare their own types.

`packages/clients/usda` is the reference implementation: `schemas.ts` validates the **raw upstream wire
shape** the moment a body arrives, and deliberately differs from the normalized public type the client
returns. **Do not delete those schemas in the name of this section, and do not add an OpenAPI contract
for an API we do not serve.** §15.1's reasoning does not apply: duplication is only wrong when one side
could have been derived from the other, and here it could not.

### 15.4 Input validation — one parse at the boundary, and the database schema is its FLOOR

**The rule:** every input a service accepts is **parsed at the boundary against the service's own authored
zod** — the same `*.schema.ts` §15.2 already requires — before any branch, any write, and any outbound call.
Downstream code receives a parsed type. It never re-checks an `unknown`, and it never hand-writes its own
error path.

§15.1–15.3 decide **who authors** the contract. This subsection decides **where that contract runs**. A
service can satisfy every word of §15.2 and still accept anything, so these are separate obligations.
Portfolio-wide obligation: [`specs/governance-rules.md` GR-016](../specs/governance-rules.md). Reasoning and
rejected alternatives: [ADR-0015](architecture/decisions/0015-input-validation-at-every-boundary.md).

**Measured 2026-08-11, before this subsection existed** — validation is three different mechanisms and one
service has none:

| Service                         | `ZodValidationPipe` | `createZodDto` | State                                                                     |
| ------------------------------- | ------------------- | -------------- | ------------------------------------------------------------------------- |
| `@kitchensink/recipe-service`   | 18                  | 26             | furthest along, **19 files still on `class-validator`** — two mechanisms  |
| `@kitchensink/food-service`     | **0**               | **0**          | **no pipe at all** — `@Body() body: unknown` + per-method `safeParse`     |
| `@kitchensink/identity-service` | 3                   | 4              | smallest surface; `PATCH /users/me` is the wrong-pipe case (15.4.4 below) |

> ⚠️ **Two corrections to that table, measured 2026-08-12 — read these before using its numbers.**
>
> 1. **"19 files still on `class-validator`" is a MENTION count, not an importer count.** `grep -rl "from
'class-validator'"` over service sources (excluding `dist`) returns **one** file:
>    `packages/services/recipe-service/src/search/dto/search-recipes.query.dto.ts`. The other 18 mention the
>    string in JSDoc **about migrating away from it**. Recipe is **one file** from one mechanism, not nineteen —
>    a difference that changes whether this is a task or a project. **Count importers, not mentions.**
> 2. **Identity is now 6 / 6**, and **food's fix is in the working tree but uncommitted** (5 / 3). Committed
>    `main` still has food at 0 / 0, which is what makes food the standing proof that §15.2 and §15.4 are
>    independent: it has a schema package, a derived `openapi.yaml`, and no validation.

Food's shape is the instructive one: because each method hand-writes its own `safeParse` and its own message,
a **wrong-typed field**, a **missing field** and an **unknown key** all come back as
`{ error: 'Empty name' }`. Three different failures, one wrong answer — the caller cannot fix any of them.

1. **One mechanism per service, and it is `createZodDto` + `nestjs-zod`'s `ZodValidationPipe`.** Bodies, path
   params, query params and any header a handler reads go through it. No second DTO, no `class-validator`
   decorator set alongside it, no per-method `safeParse`. Two mechanisms in one service means two error
   contracts and two sets of edge cases, and which one a route gets becomes a per-file accident.
2. **Validation failure has ONE path per service** — a `400` that names the offending field(s). A
   hand-written message per method is how three distinct failures collapse into one string.
3. **`@Body() body: unknown` is banned.** It moves the parse into the method body, where it is optional by
   construction and gets skipped on the next endpoint someone adds.
4. ⚠️ **`createZodDto` requires `nestjs-zod`'s `ZodValidationPipe`. Under Nest's own built-in
   `ValidationPipe` it validates NOTHING while looking correctly wired.** The schema is present, the DTO is
   referenced, the route reads as validated, and no input is checked. This already bit identity on
   **`PATCH /users/me`** — a route that writes user data. It is invisible in review by construction, so the
   only thing that catches it is a test that posts a **known-bad body to a real route** and asserts the
   `400`. Write that test per controller.
5. ⚠️ **`z.object()` strips unknown keys silently; `z.strictObject()` rejects them.** **`z.strictObject()` is the
   portfolio default for every MUTATING request body** (`POST`/`PUT`/`PATCH`/`DELETE`-with-a-body), ruled
   2026-08-12 — see **§15.5.2**, which closed GR-016 OPEN-GR-016-B. Plain `z.object()` is permitted only where a
   forward-compatibility reason is **documented at the schema**, which in practice means a **read** surface such
   as a query string. Inheriting zod's default by accident means a client that misspells a field gets a `200`
   and no write.
6. **The surfaces a pipe never sees are in scope.** A Nest pipe covers HTTP only:
    - **Queue and event consumers** — `packages/services/recipe-workers/src/handlers/*`, food's
      change-refresh / SQS consumers. An SQS body is a string the producer chose; parse it against an
      authored zod before it becomes a job.
    - **Webhooks** — `packages/services/identity-webhooks/src/handlers/*`. `identityWebhook.ts` verifies the
      **svix signature**, and that stays. **But a signature proves ORIGIN, not SHAPE.** A correctly signed
      Clerk payload whose fields moved or went null is still an unvalidated body being written to the
      identity database. Verify the signature **and then** validate the schema — never one instead of the
      other.
7. **Nothing reaches a database or another service unvalidated.** A DAL is not where input first meets a
   constraint. On a service-to-service call — recipe → food, and identity's erasure fan-out
   (`packages/services/identity-webhooks/src/common/erasure-fanout.ts`) →
   `POST /api/v1/internal/account/erasure` on recipe and food — the **outbound body is validated against the
   callee's schema-package zod before the call**, and the **inbound response is validated on receipt**.
   "Internal" is not a synonym for "trusted".
8. **THE FLOOR: every input field that writes a bounded column is validated at least as strictly as that
   column can store.** Numeric range, string length, precision/scale, enum domain, nullability. A value the
   column cannot hold is a **`400` at the boundary**, never a failed `INSERT`.

    The live defect: five int-backed recipe wire fields — `servings`, `prepTimeMinutes`, `cookTimeMinutes`,
    `totalTimeMinutes`, `timerSeconds` — had **no upper bound** while writing `integer` (`int4`) columns
    capped at **2,147,483,647**. `servings: 9999999999` **passed validation** and failed at the `INSERT`:
    **a 500 that should have been a 400**, on a plain user input.

    ⚠️ **This is an ASSERTION about two independently authored artifacts, NOT a derivation between them.**
    **Zod is never generated from drizzle, and a wire type never imports a storage type** — that coupling is
    exactly what §15.2 removed when it flagged `RecipeSearchResponse.facets` taking its wire type from
    `../dal/search.dal.js`. The `*.schema.ts` import constraint is **unchanged** by this subsection. The two
    artifacts stay independent and must agree in **one direction only**: the wire bound is at least as tight
    as the column.

    **And a floor is not a target.** Recipe's text columns are `text()` — **unbounded** in PostgreSQL — so a
    length limit on a title, a step or a note is a **product decision with no storage floor to derive from**.
    "The column allows it" is not an argument for accepting it.

9. **No request-derived value may reach `sql.raw()`.** `sql.raw` **bypasses parameterisation by design**.
   Measured 2026-08-11, only three sites pass it a non-literal, and all three take a config value or a module
   constant, so **none is currently reachable from user input**:
   `packages/services/recipe-service/src/search/dal/search.dal.ts`, and recipe-workers'
   `erasure-sweeper.ts` / `erasure-orphan-sweeper.ts`. Preserve that. Where a request legitimately selects an
   identifier (a sort column, a partition), the **validated enum maps to a closed allowlist of literals in
   code** — the request supplies the key, never the SQL fragment.
10. ⛔ **Response validation is DEFERRED, deliberately — do NOT "complete" it.** No service validates its own
    responses, and that is an owner decision: TypeScript at the boundary plus client-side validation on
    receipt (rule 7) were judged sufficient for now. Adding server-side response parsing **undoes a
    decision** rather than closing a gap. The cost is recorded honestly instead of hidden — §15.2(5)'s
    `oasdiff` blind spot means response changes are weakly gated — but that is an argument about the drift
    gates, not a licence to reverse the deferral. Reversing it needs its own proposal.

> **Why rule 7's receipt-validation is not rule 10's response validation.** A **consumer** parsing what it
> received is defending itself and can do so unilaterally. A **producer** validating what it emits is a
> different, deferred obligation. Requiring the first does not quietly enact the second.

### 15.5 Conformance for every NEW service, client and app — and what happens when input is REJECTED

§15.2 and §15.4 are written as obligations on **existing** code. This subsection is what makes them binding on
code that does not exist yet, and it is where the **failure** side of the boundary parse is decided. Portfolio
obligations: [`specs/governance-rules.md`](../specs/governance-rules.md) **GR-017** (conformance), **GR-018**
(rejection), **GR-019** (identifiers), **GR-020** (dual-signal principals). GR-017 §17-e carries the fourteen
things a feature spec must state and marks which of them are mechanically checkable.

#### 15.5.1 A new package owes its obligations on the day it is created, and the gate must DISCOVER it

A **new deployable HTTP service** owes, from its first commit: authored zod at `src/**/*.schema.ts`; a
`contract:generate` script; a committed `packages/schemas/<service>` with the derived `openapi.yaml`; a
`CONTRACT_HASH` assertion **at boot**; **`nestjs-zod`'s** `ZodValidationPipe` registered; `z.strictObject()` on
mutating bodies; a parse on every non-HTTP ingress it owns; and the four test tiers §7.1 requires of a
deployable. A **new client or app package** owes: zero declared wire shapes, imports of type **and** zod from
the schema package, **response validation on receipt**, outbound bodies validated against the **callee's** zod,
and a contract-skew guard (`packages/clients/{food-service,recipe-service}/src/contractSkew.ts` is the pattern).

⚠️ **A conformance test that enumerates services or clients from a hardcoded list is itself the defect.** A list
is a thing to forget, and the package created next week will not be on it. Every gate discovers its subjects
from `packages/services/*/package.json`, `packages/clients/*/package.json`, `packages/schemas/*/package.json`
or `git ls-files` — the pattern already used by
`packages/infra/global/__tests__/app-service-dependency.test.ts` (discovers services, scans `git ls-files`,
counts type-only imports as violations) and by `scripts/contractOwners.mjs` `discoverContractOwners`.

⚠️ **`*.schema.ts` is an overloaded suffix — a globbing gate must not treat every match as a wire contract.**
Each service also has `src/config/env.schema.ts`, its Zod **environment** schema, which is deliberately not
published. `@kitchensink/contract-gen`'s `discoverAuthoredSchemas` already owns the exclusion (exact relative
paths, each with a reason, failing on a **stale** entry, and separately rejecting an authored wire schema that
imports an excluded sibling). A new gate reuses that list rather than inventing a second one.

**The honest state of enforcement is recorded in GR-017 → _Enforcement_, including the gates that do NOT exist**
(clients-declare-no-wire-types, `z.strictObject()`, and the storage-floor mapping-completeness assertion). Read
it before assuming a rule here is checked.

#### 15.5.2 `z.strictObject()` for mutating bodies (closes GR-016 OPEN-GR-016-B)

Every mutating request body uses `z.strictObject()`. Plain `z.object()` needs a documented
forward-compatibility reason at the schema. The trade is genuine in both directions — rejecting unknown keys
catches a client's typo, accepting them lets a newer client talk to an older service — and the ruling picks the
direction whose failure is **visible**: on a mutating body a stripped unknown key is a `200` **plus a silent
partial write**, so the caller is told it succeeded and the stored data is not what it sent.

#### 15.5.3 The storage floor is a per-service parity TEST — and it is ALREADY BUILT (closes GR-016 OPEN-GR-016-A)

§15.4(8)'s floor is enforced by a test, not a review checklist — a checklist cannot survive a migration six
months from now. ✅ **The mechanism exists**: `@kitchensink/contract-gen`'s `auditStorageCapacity` /
`collectBoundedColumns` / `formatStorageCapacityFindings`
(`packages/tools/contract-gen/src/storage-capacity.ts`), wired by a `storage-capacity.test.ts` in **all three**
services (`recipe-service/src/database/__tests__/`, `food-service/src/db/schema/__tests__/`,
`identity/src/types/schema/__tests__/`). **A new service copies that pattern; it does not invent one.** Four
properties are load-bearing:

1. It lives in the **service**, not in the schema package and not in the wire schemas.
2. **It is an assertion over two independently parsed models, never a derivation.** It takes the drizzle tables
   as `unknown` and reads them **structurally** through drizzle's registered symbols
   (`Symbol.for('drizzle:Columns')`), so `contract-gen` carries **no `drizzle-orm` dependency** — it is imported
   by all three services and must not drag an ORM behind it. It reads zod bounds through the **public**
   `z.toJSONSchema`, not zod internals, which is what makes `.optional()`/`.nullable()`/`.default()`/`z.coerce`
   unwrap without a hand-rolled walker. ⛔ Do **not** "tidy" this by adding a `drizzle-orm` dependency or by
   reaching into zod's internals.
3. The field→column **mapping is supplied per service by the caller**, because two wire fields may write one
   column and a column may be written by none — that knowledge is genuinely the service's.
4. **The audit is exhaustive over COLUMNS.** Every bounded column is either bound to the fields that write it or
   declared not-client-writable **with a reason**, so a new `varchar(n)` or `smallint` fails the gate the day it
   is added. `stale-account` and `duplicate-account` findings keep the bookkeeping honest in the other direction.

#### 15.5.4 ONE rejection path, the cause in a `reason`, and an invalid payload is NEVER retried

Every boundary rejection takes **one** code path per ingress and produces **one** structured shape whose
`reason` names the cause. **A credential/signature failure and a shape failure are equally invalid and MUST NOT
have two different behaviours** — they differ only in `reason`. An invalid payload is **never retried**: it
cannot become valid by being sent again, so retrying converts a producer's bug into sustained load. (A
**transient dependency** failure is a different condition with a different `reason` and MAY retry.)

⚠️ **For a signature-verifying third-party sender, "not retried" means answering `2xx` — but ONLY for a SHAPE
failure.** svix (Clerk) and Stripe retry on **any** non-2xx (Stripe for 72 hours), so returning `400` for a body
that cannot parse _requests_ the retry storm this rule forbids. Answer `2xx`, and record the rejection in the
response body, in structured logs with its `reason`, in a per-`reason` counter, and **alarm on that counter**.
**Reject the content, accept the delivery.**

⛔ **A SIGNATURE failure on the same endpoint is answered NON-2xx, and collapsing the two onto one status breaks
something either way.** "Not retried" applies to input that **cannot become valid**. A signature failure has two
possible causes and both argue against `2xx`: the caller may not be the real sender (and on a public endpoint the
signature is the _only_ trust boundary, so a `2xx` tells a forger the forgery landed), or the caller **is** the
real sender and **our** signing secret is stale — a **transient, operator-fixable** condition where the sender's
retry window is exactly the recovery mechanism. Answering `2xx` there says "delivered" and discards every queued
real event permanently, behind a green check. **That incident is on record in this repository** (a dropped
`user.created` left Clerk holding a user the database did not), and an earlier revision of
`packages/services/identity-webhooks/src/common/handler-pipeline.ts` caused it by returning `2xx` for both.

So the rule is **one path, one shape, one `reason`, one counter** — with the **status derived from the `reason`
by a single complete lookup**, so adding a reason fails to compile until its retry disposition is decided.
`WEBHOOK_REJECTION_STATUS` (`shape → 200`, `signature → 401`) in that same file is the reference. The question a
status answers is **"would a redelivery ever succeed?"**

None of this generalises to our own callers: an endpoint called by our own services or clients returns the
`400`/`403` §15.4(1) requires (they do not blind-retry, and a `2xx` would hide a fixable bug from the party able
to fix it), and an ingress with no caller at all (SQS, EventBridge) dead-letters once with the `reason` and
alarms on DLQ depth.

⛔ **A rejected event is NOT recorded as a row.** An invalid payload has no trustworthy identifier, and a table
whose identity column is `NOT NULL` forces the writer to invent one — the sentinel §15.5.5 forbids. This is
live: `webhook_events.identity_id` in the identity database is `text NOT NULL`. The log line, the counter and
(where applicable) the DLQ entry **are** the record, which makes them load-bearing rather than decorative — a
rejection nobody can see is indistinguishable from a success.

#### 15.5.5 Identifiers are never sentinels

No identifier — a user id, a producer name, a tenant, a principal — may be `'unknown'`, `'none'`, `''`, `'n/a'`
or `0`, anywhere it is **stored**, **put on a wire**, used as a **map/cache key**, used as a **metrics
dimension**, or **compared in a branch**. (A sentinel in a log _message_ is prose; in a structured log _field_
it is data.) An id is **REQUIRED** wherever one is consumed and is typed as required, never
optional-with-a-default. The sole exception is a **create/upsert**, where an absent id is **generated** (ULID).
An identifier that cannot be resolved is a **rejection** (§15.5.4), never a placeholder — a sentinel is silently
wrong in every aggregate it touches, is indistinguishable from a real value afterwards, and when the id is a
principal it means an authorization decision was made by a string literal. A legitimately absent relationship
is `NULL` and `| null`, which is checkable; a magic string is not.

#### 15.5.6 Where two principals are asserted, require BOTH and reject on mismatch

Where a request carries both a **transport-asserted** principal (a token `sub`, an EventBridge `source`) and a
**payload-asserted** one, both are REQUIRED, the transport signal must **resolve through a version-controlled
registry to a name** (an allowlist that only answers yes/no cannot attribute a counter or a quota), the two must
be **equal**, and a mismatch is a **rejection** — never resolved by preferring one signal, and the
payload-asserted value is **never** trusted on its own. The registry mapping must be **injective, asserted at
boot**, and must be committed data rather than a table: a runtime write would change a trust boundary with no
review and no deploy. The transport signal proves **origin**, the payload field states **intent**, and a
disagreement is real evidence — a misconfigured producer, a payload copied between environments, an attempt to
spend another principal's quota. Precedent: PR #39 removed the trusted `x-authorizer-context` header from the
identity service because a client-suppliable header behind a public ALB is forgeable; a payload field the sender
controls is the same problem one layer in.

### Rules

1. A `packages/clients/*` package MUST NOT declare a type describing a request or response body of a
   service in `packages/services/*`. Import it from that service's contract package.
2. Every HTTP service MUST emit an OpenAPI document from its DTOs, committed, with the drift and
   breaking-change gates wired in CI.
3. A new endpoint is not complete until its types are reachable from the contract package. "The client
   will add the type" is a contract fork, not a task.
4. A third-party API client MUST validate responses at the boundary with a runtime schema, and MUST NOT
   be given a hand-written OpenAPI document for an API we do not serve.
5. Where this section and an existing hand-written client type conflict, **this section wins** — the
   client is the one that changes.
6. Every service input — HTTP body/params/query, queue message, event, webhook payload — MUST be parsed at
   the boundary by the service's authored zod, through **one** mechanism per service with **one** `400` path.
   `@Body() body: unknown` is banned; a signature check is not a schema check.
7. Every input field writing a **bounded column** MUST be validated at least as strictly as that column can
   store, **asserted** — never by generating zod from drizzle or importing a storage type into a wire schema.
8. A request-derived value MUST NOT reach `sql.raw()`. Request-selected identifiers map through a validated
   enum to a closed allowlist of literals.
9. Server-side **response** validation MUST NOT be added while §15.4(10)'s deferral stands. Consumer-side
   validation **on receipt** is required and is a different obligation — do not conflate them.
10. A **new** service or client package MUST satisfy §15.5.1 from its first commit, and every conformance gate
    MUST **discover** its subjects from the filesystem. A hardcoded list of services or clients in a
    conformance test is itself a violation, because it cannot see the next package.
11. Every **mutating** request body MUST use `z.strictObject()` (§15.5.2). Plain `z.object()` requires a
    forward-compatibility reason documented at the schema.
12. Every boundary rejection MUST take **one** path per ingress carrying the cause in a `reason` field, and an
    **invalid** payload MUST NOT be retried — which for a signature-verifying third-party sender means
    answering **`2xx`** on a **shape** failure, with the rejection recorded, counted **and alarmed**. A
    **signature** failure on that same ingress MUST answer **non-2xx**, because it may be our own stale secret
    and the sender's retry is the recovery (§15.5.4). The status MUST come from **one complete reason→status
    lookup**, never a second branch. A rejected payload MUST NOT be written as a row.
13. An identifier MUST NEVER be a sentinel, and MUST be required everywhere it is consumed except on a
    create/upsert, where it is generated (§15.5.5). Where two principals are asserted, **both** are required
    and a mismatch is a rejection (§15.5.6).
