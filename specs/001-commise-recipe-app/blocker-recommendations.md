# Blocker Recommendations — 001 Commise Recipe App

_Date: 2026-05-12_
_Updated: 2026-05-13 — GR-002 documentation/contract paths and GR-007 task wording corrected for handoff._

## 1. API URL prefix collision

### Recommendation

Adopt `/api/v1/{resource-path}` as the only public API pattern, and keep ownership at the bounded-context level rather than under `/users/:id/...`. For recipe resources, 001 should own `/api/v1/recipes*`; 004 should own import-only endpoints under `/api/v1/recipes/import/*`; 002 should own `/api/v1/users/me`, `/api/v1/accounts/me`, and auth-related backend endpoints. Framework-internal Next.js routes such as `/api/v1/auth/*` should stay out of scope.

### What is colliding now

`001` is the only feature with an OpenAPI contract today, and it previously placed every endpoint under bare `/api/*`; the contract has been normalized to `/api/v1/*`:

- `/api/v1/recipes`
- `/api/v1/recipes/{id}`
- `/api/v1/recipes/{id}/clone`
- `/api/v1/recipes/{recipeId}/versions/*`
- `/api/v1/recipes/{recipeId}/photos/*`
- `/api/v1/collections/*`
- `/api/v1/ingredients` and `/api/v1/ingredients/search`
- `/api/v1/search/recipes`
- `/api/v1/account/erasure`

Downstream feature artifacts use bare `/v1/*` instead:

- `002`: `/v1/users/me`, `/v1/accounts/me`, `/v1/auth/webhook`
- `003`: `/v1/foods/*`
- `004`: `/v1/recipes/import/*` and `POST /v1/recipes/{id}/clone`
- `006`: `/v1/meal-plans/*`
- `007`: `/v1/grocery-lists/*`
- `008`: consumes `GET /v1/recipes/{id}/instructions`
- `009`: `/v1/nutrition-plans/*`
- `010`: `/v1/billing/*`
- `011`: already aligned on `/api/v1/*`

There is also one concrete resource-level duplicate after normalization: `POST /recipes/{id}/clone` is claimed by both 001 and 004. Keep that endpoint in **001** and remove it from 004's public contract. Also add `GET /api/v1/recipes/{id}/instructions` to 001 now so 008 does not invent a second recipe-read surface.

### Canonical scheme

Prefer top-level resource routes over user-nested ones:

- `/api/v1/recipes`
- `/api/v1/recipes/{id}`
- `/api/v1/recipes/{id}/clone`
- `/api/v1/recipes/{id}/instructions`
- `/api/v1/recipes/{id}/versions`
- `/api/v1/recipes/{id}/photos`
- `/api/v1/collections`
- `/api/v1/ingredients/search`
- `/api/v1/search/recipes`
- `/api/v1/account/erasure`
- `/api/v1/users/me`
- `/api/v1/accounts/me`
- `/api/v1/foods/*`, `/api/v1/meal-plans/*`, `/api/v1/grocery-lists/*`, `/api/v1/nutrition-plans/*`, `/api/v1/billing/*`

### Features that need migration

| Feature | Migration                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `001`   | ✅ Updated public endpoint references to `/api/v1/*` in `spec.md`, `plan.md`, `tasks.md`, V-Model/Product Forge artifacts, and `contracts/api.openapi.yaml`. |
| `002`   | Add `/api` to backend API refs; leave framework-owned Next.js `/api/v1/auth/*` routes unchanged.                                                             |
| `003`   | Change `/v1/foods/*` to `/api/v1/foods/*`.                                                                                                                   |
| `004`   | Change import routes to `/api/v1/recipes/import/*`; remove public clone endpoint from 004 and point to 001-owned clone.                                      |
| `005`   | Enforce `/api/v1/*` before public endpoint design hardens.                                                                                                   |
| `006`   | Change `/v1/meal-plans/*` to `/api/v1/meal-plans/*`.                                                                                                         |
| `007`   | Change `/v1/grocery-lists/*` to `/api/v1/grocery-lists/*`.                                                                                                   |
| `008`   | Update dependency refs to `GET /api/v1/recipes/{id}/instructions`.                                                                                           |
| `009`   | Change `/v1/nutrition-plans/*` to `/api/v1/nutrition-plans/*`.                                                                                               |
| `010`   | Change `/v1/billing/*` to `/api/v1/billing/*`.                                                                                                               |
| `011`   | No migration needed; already on `/api/v1/*`.                                                                                                                 |

### Breaking-change blast radius

- **If fixed now:** low runtime blast radius, medium artifact churn. There are no live clients yet, so this is mostly spec, task, test, and generated-client cleanup.
- **If deferred to beta:** high blast radius. The team will either break clients or carry dual-route aliases, duplicated observability, duplicated auth/policy config, and repeated SDK regeneration.

### ROM / milestone

- **ROM:** M
- **Milestone:** **M0 decision, M1 execution.** Ratify the canonical scheme and ownership matrix in M0, then require 001/002/003/004/006/007/008/009/010 artifacts to be updated before M1 implementation starts.

---

## 2. Shared `@kitchensink/shared-recipe-core`

### Recommendation

Create `packages/shared/recipe-core` as an internal workspace package named `@kitchensink/shared-recipe-core`. Keep it pure TypeScript + Zod only, and make it the single source of truth for recipe-domain entities and API-facing payload types shared by web, mobile, and API.

### Put inside the package

- Domain enums / value objects: `RecipeVisibility`, `RecipeSourceType`, `PhotoProcessingStatus`, `RecipeSearchSortBy`, canonical recipe-domain error codes.
- Shared entities / read models: `Recipe`, `RecipeStep`, `Ingredient`, `RecipeIngredient`, `RecipePhoto`, `RecipeSnapshot`, `RecipeVersion`, `Collection`, `RecipeCollection`.
- Shared command / query shapes: `CreateRecipeIngredientInput`, `CreateRecipeInput`, `UpdateRecipeInput`, `RecipeSearchParams`, `RecipeSearchResult`, `PaginatedResponse`, plus public request/response interfaces that mirror 001's OpenAPI contract.
- Zod schemas for the exported types above.

### Keep out of the package

- `config.types.ts` — this belongs in `packages/shared/config`.
- NestJS DTO classes and `class-validator` decorators.
- Drizzle table row types, migrations, and DAL-only persistence models.
- S3/SQS/Lambda event payloads for photo processing or version archiving.
- Non-recipe contracts owned by other bounded contexts (Clerk user/account, USDA food, meal plans, grocery lists, nutrition) unless they later warrant their own sibling shared package.

### Publishing strategy

Use a **workspace package**, not a standalone npm release, for M0/M1. Build it to `dist/` with stable exports and consume it via `workspace:*`; that keeps the import path stable if the team later decides to publish to a private registry, without adding registry/release overhead now.

### Migration path (no big-bang rewrite)

1. Seed the package from `contracts/recipe.types.ts`, trimming internal-only types before first export.
2. Add `index.ts` exports plus build plumbing (`main`, `types`, `exports`, Turbo `^build` dependency).
3. Have 001 API, web, and mobile import core types immediately; keep NestJS DTOs local and make them `implements` the shared interfaces.
4. Update 004 and 008 next, since they already depend on recipe clone/instruction contracts.
5. Migrate later features opportunistically when implementation starts; ban new local copies instead of rewriting the entire repo at once.

### ROM / milestone

- **ROM:** S
- **Milestone:** **M1 implementation, with M0 boundary freeze.** Finalize the package boundary and first-task ordering in M0, then create the package as one of the first M1 engineering tasks.

### Risk if deferred to beta

High. By then 004/008/006/007/009 will likely have local copies of `Recipe`, `Ingredient`, `Step`, or search payloads, turning a small shared-package setup into a multi-feature refactor with serialization and validation drift to unwind.

---

## Recommended follow-up tasks

1. Update `001/spec.md`, `001/plan.md`, `001/tasks.md`, and `001/contracts/api.openapi.yaml` to `/api/v1/*`; add `GET /api/v1/recipes/{id}/instructions`.
2. Remove `POST /recipes/{id}/clone` from 004's public contract/tasks and treat clone as a 001-owned endpoint.
3. Add or refresh `docs/api-conventions.md` (or equivalent) so GR-002 points to one concrete route ownership document.
4. Freeze the initial export list for `@kitchensink/shared-recipe-core` and make it a first-wave 001 setup task before any API or UI implementation.
