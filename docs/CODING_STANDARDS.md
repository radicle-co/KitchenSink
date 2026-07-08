# Coding Standards

Tactical conventions for the KitchenSink monorepo. This document is the authoritative
reference for day-to-day coding decisions. The [Constitution](../.specify/memory/constitution.md)
defines immutable principles; this document translates them into enforceable rules.

**Version**: 1.2.0 | **Created**: 2026-04-19 | **Last Updated**: 2026-05-10

---

## 1. File Naming

| Context                                       | Convention                     | Example                                         |
| --------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| Default (utilities, services, types, configs) | `camelCase.ts`                 | `recipeService.ts`, `parseIngredient.ts`        |
| React components                              | `PascalCase.tsx`               | `RecipeCard.tsx`, `IngredientList.tsx`          |
| Classes (non-component)                       | `PascalCase.ts`                | `RecipeRepository.ts`, `ImageProcessor.ts`      |
| Mobile (Expo/React Native) variant            | `<source>.native.ts(x)`        | `RecipeCard.native.tsx`, `storage.native.ts`    |
| Test files                                    | `<source>.test.ts`             | `recipeService.test.ts`, `RecipeCard.test.tsx`  |
| Integration tests                             | `<source>.integration.test.ts` | `recipeApi.integration.test.ts`                 |
| E2E tests (Playwright)                        | `<feature>.spec.ts`            | `recipeSearch.spec.ts`                          |
| Barrel files                                  | `index.ts`                     | `index.ts` (re-exports only, no implementation) |
| Config files                                  | `<tool>.config.ts` or dotfile  | `vitest.config.ts`, `.prettierrc`               |

### Rules

- One class or component per file. No exceptions.
- The filename MUST match the exported class or component name exactly.
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

- Aliased imports: `.js` / `.jsx` extensions
- Relative imports: `.ts` / `.tsx` extensions

```typescript
// Good — aliased imports with .js extension
import { describe, it, expect } from 'vitest';
import type { Recipe } from '@kitchensink/models';
import { RecipeService } from '@kitchensink/core';
import { makeRecipe } from '@/e2e/__fixtures__/makeRecipe.js';

// Bad — relative import crossing workspace boundaries
import type { Recipe } from '../../models/Recipe.js';

// Bad — .ts extension on aliased import
import type { Recipe } from '@/models/Recipe.ts';
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

**Rule of thumb: if it lives under `packages/apps/commise/`, it's `@commise/*`; otherwise it's `@kitchensink/*`.** A domain's *backend* (service/client/types) is platform, while its Commise *widget / feature UI* is product — e.g. feature 001 adds the recipe backend as `@kitchensink/recipe-service` (alongside today's `@kitchensink/food-service`) and its Home widget as `@commise/features-recipes`. CDK stack/resource names (`kitchensink-*`) are a separate namespace and are **not** governed by this rule.

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

| Work under test | REQUIRED tests — write **ALL** of them, test-first. Omitting **any one** = the work is INCOMPLETE. |
| --------------- | -------------------------------------------------------------------------------------------------- |
| **UI code** (components, screens, hooks) | (1) a **vitest component test** (React Testing Library) for **EVERY** UI path/state — loading, empty, populated, error, gated, disabled, and every other branch — **NOT just the happy path, NOT a representative sample; every single path**; **AND** (2) a **Playwright** test (web) for **EVERY** happy-path / user story — Playwright **IS** the UI's integration test. Mobile parity: a **Maestro** flow per story. |
| **Non-UI code** (services, DALs, domain logic, controllers, DTOs, workers, libraries, utilities) | **unit tests AND integration tests — BOTH, always.** Integration exercises the **real** dependency (Docker Postgres for the DB, LocalStack for AWS). A unit test alone is a **VIOLATION**. |
| **Services** (deployable HTTP APIs) | everything above **PLUS end-to-end tests** (boot the service against real Postgres + LocalStack and drive it over HTTP) **AND k6 load/performance tests** (assert the service's latency/throughput SLOs). Unit + integration alone is **NOT SUFFICIENT** for a deployable API. |

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

- **Unit tests**: `__tests__/` directories co-located with source, named `*.test.ts`
- **Integration tests**: `__integration__/` directories co-located with source, named `*.integration.test.ts`
- **E2E tests**: `e2e/` directory at the workspace root, named `*.spec.ts`
- **Mocks**: `__mocks__/` directories co-located with source
- **Fixtures**: `__fixtures__/` directories co-located with tests

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
