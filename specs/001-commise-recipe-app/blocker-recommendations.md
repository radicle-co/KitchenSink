# Blocker Recommendations — 001 Commise Recipe App

_Date: 2026-05-12_
_Updated: 2026-05-13 — GR-002 documentation/contract paths and GR-007 task wording corrected for handoff._
_Reconciled: 2026-07-06 — **SUPERSEDED where noted** per the 2026-07-06 reconciliation. The canonical public API prefix is bare `/v1/*` (matching shipped 002/003), **not** the `/api`-prefixed `v1` scheme this document originally proposed — that recommendation is REVERSED. The shared recipe types package is `@kitchensink/recipe-core` (folder `packages/shared/recipe-core`) — the rename was `shared-recipe-core` → `recipe-core`, a **name** change under the same `@kitchensink` scope, **not** a scope change. Historical recommendations are retained below and annotated inline._

## 1. API URL prefix collision

> **SUPERSEDED (2026-07-06).** The recommendation below originally standardized on an `/api`-prefixed `v1` scheme. That is **reversed**: shipped identity (002) and food (003) services expose bare `/v1/*` (`@Controller('v1/...')`), so the canonical public prefix is **`/v1/*`**. All endpoint references in this section have been updated to `/v1/*`; the collision analysis and ownership matrix are preserved as history, re-pointed at the correct convention. Framework-internal Next.js routes (`/api/...` inside the web app) are not public API and are unaffected.

### Recommendation

Adopt `/v1/{resource-path}` as the only public API pattern, and keep ownership at the bounded-context level rather than under `/users/:id/...`. For recipe resources, 001 should own `/v1/recipes*`; 004 should own import-only endpoints under `/v1/recipes/import/*`; 002 should own `/v1/users/me`, `/v1/accounts/me`, and auth-related backend endpoints. Framework-internal Next.js routes such as `/api/auth/*` should stay out of scope.

### What is colliding now

`001` was the only feature with an OpenAPI contract that diverged: it previously placed every endpoint under bare `/api/*` and was then briefly normalized to the `/api`-prefixed `v1` scheme. The shipped services (002/003) and every other downstream feature use bare `/v1/*`, so 001 (and 011) are the outliers that must conform. The 001 contract is normalized to bare `/v1/*`:

- `/v1/recipes`
- `/v1/recipes/{id}`
- `/v1/recipes/{id}/clone`
- `/v1/recipes/{recipeId}/versions/*`
- `/v1/recipes/{recipeId}/photos/*`
- `/v1/collections/*`
- `/v1/ingredients/search`
- `/v1/search/recipes`
- `/v1/account/erasure`

Downstream feature artifacts already use bare `/v1/*` (this is the convention 001 conforms to):

- `002`: `/v1/users/me`, `/v1/accounts/me`, `/v1/auth/webhook`
- `003`: `/v1/foods/*`
- `004`: `/v1/recipes/import/*` and `POST /v1/recipes/{id}/clone`
- `006`: `/v1/meal-plans/*`
- `007`: `/v1/grocery-lists/*`
- `008`: consumes `GET /v1/recipes/{id}/instructions`
- `009`: `/v1/nutrition-plans/*`
- `010`: `/v1/billing/*`
- `011`: was aligned on the `/api`-prefixed scheme; must move to bare `/v1/*`

There is also one concrete resource-level duplicate: `POST /recipes/{id}/clone` is claimed by both 001 and 004. Keep that endpoint in **001** and remove it from 004's public contract. Also add `GET /v1/recipes/{id}/instructions` to 001 now so 008 does not invent a second recipe-read surface.

### Canonical scheme

Prefer top-level resource routes over user-nested ones:

- `/v1/recipes`
- `/v1/recipes/{id}`
- `/v1/recipes/{id}/clone`
- `/v1/recipes/{id}/instructions`
- `/v1/recipes/{id}/versions`
- `/v1/recipes/{id}/photos`
- `/v1/collections`
- `/v1/ingredients/search` (thin proxy over the food service (003) via its typed client;
- `/v1/search/recipes`
- `/v1/account/erasure`
- `/v1/users/me`
- `/v1/accounts/me`
- `/v1/foods/*`, `/v1/meal-plans/*`, `/v1/grocery-lists/*`, `/v1/nutrition-plans/*`, `/v1/billing/*`

### Features that need migration

Because the canonical prefix is bare `/v1/*`, the services already on `/v1/*` need **no** change; only the features that were on the `/api`-prefixed scheme (001, 011) migrate.

| Feature | Migration                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001`   | Revert public endpoint references to bare `/v1/*` in `spec.md`, `plan.md`, `tasks.md`, V-Model/Product Forge artifacts, and `contracts/api.openapi.yaml` (the `/api`-prefixed pass is undone). |
| `002`   | No change — already on bare `/v1/*` (`/v1/users/me`, `/v1/accounts/me`); leave framework-owned Next.js auth routes unchanged.                                                                |
| `003`   | No change — already on `/v1/foods/*`.                                                                                                                                                        |
| `004`   | Keep import routes on `/v1/recipes/import/*`; remove the public clone endpoint from 004 and point to the 001-owned `/v1/recipes/{id}/clone`.                                                  |
| `005`   | Enforce bare `/v1/*` before public endpoint design hardens.                                                                                                                                  |
| `006`   | No change — already on `/v1/meal-plans/*`.                                                                                                                                                   |
| `007`   | No change — already on `/v1/grocery-lists/*`.                                                                                                                                                |
| `008`   | Update dependency refs to `GET /v1/recipes/{id}/instructions`.                                                                                                                               |
| `009`   | No change — already on `/v1/nutrition-plans/*`.                                                                                                                                              |
| `010`   | No change — already on `/v1/billing/*`.                                                                                                                                                      |
| `011`   | Move to bare `/v1/*` (was on the `/api`-prefixed scheme).                                                                                                                                    |

### Breaking-change blast radius

- **If fixed now:** low runtime blast radius, medium artifact churn. There are no live clients yet, so this is mostly spec, task, test, and generated-client cleanup.
- **If deferred to beta:** high blast radius. The team will either break clients or carry dual-route aliases, duplicated observability, duplicated auth/policy config, and repeated SDK regeneration.

### ROM / milestone

- **ROM:** M
- **Milestone:** **M0 decision, M1 execution.** Ratify the canonical scheme and ownership matrix in M0, then require 001/002/003/004/006/007/008/009/010 artifacts to be updated before M1 implementation starts.

---

## 2. Shared `@kitchensink/recipe-core`

### Recommendation

Create `packages/shared/recipe-core` as an internal workspace package named `@kitchensink/recipe-core` (per the 2026-07-06 naming convention: `packages/<category>/<name>` → `@commise/<category>-<name>`). Keep it pure TypeScript + Zod only, and make it the single source of truth for recipe-domain entities and API-facing payload types shared by web, mobile, and the recipe service.

### Put inside the package

- Domain enums / value objects: `RecipeVisibility`, `RecipeSourceType`, `PhotoProcessingStatus`, `RecipeSearchSortBy`, canonical recipe-domain error codes.
- Shared entities / read models: `Recipe`, `RecipeStep`, `Ingredient`, `RecipeIngredient`, `RecipePhoto`, `RecipeSnapshot`, `RecipeVersion`, `Collection`, `RecipeCollection`.
- Shared command / query shapes: `CreateRecipeIngredientInput`, `CreateRecipeInput`, `UpdateRecipeInput`, `RecipeSearchParams`, `RecipeSearchResult`, `PaginatedResponse`, plus public request/response interfaces that mirror 001's OpenAPI contract.
- Zod schemas for the exported types above.

### Keep out of the package

- `config.types.ts` — configuration types belong with their owning service's own config module (per-service, mirroring the identity service's `config/` Zod schema), not in the shared recipe package.
- NestJS DTO classes and `class-validator` decorators.
- Drizzle table row types, migrations, and DAL-only persistence models. (The recipe service uses the shared RDS with its own logical database `kitchensink_recipes` — there is no shared db package.)
- S3/SQS/Lambda event payloads for photo processing or version archiving.
- Non-recipe contracts owned by other bounded contexts (Clerk user/account, the source-agnostic food service (003), meal plans, grocery lists, nutrition) unless they later warrant their own sibling shared package. Recipe ingredients reference food by the food service's internal ULID (`foodId`) as an opaque reference — never the source-specific `fdcId` — so no food schema needs to live here.

### Publishing strategy

Use a **workspace package**, not a standalone npm release, for M0/M1. Build it to `dist/` with stable exports and consume it via `workspace:*`; that keeps the import path stable if the team later decides to publish to a private registry, without adding registry/release overhead now.

### Migration path (no big-bang rewrite)

1. Seed the package from `contracts/recipe.types.ts`, trimming internal-only types before first export.
2. Add `index.ts` exports plus build plumbing (`main`, `types`, `exports`, Turbo `^build` dependency).
3. Have the recipe service, web, and mobile import core types immediately; keep NestJS DTOs local and make them `implements` the shared interfaces.
4. Update 004 and 008 next, since they already depend on recipe clone/instruction contracts.
5. Migrate later features opportunistically when implementation starts; ban new local copies instead of rewriting the entire repo at once.

### ROM / milestone

- **ROM:** S
- **Milestone:** **M1 implementation, with M0 boundary freeze.** Finalize the package boundary and first-task ordering in M0, then create the package as one of the first M1 engineering tasks.

### Risk if deferred to beta

High. By then 004/008/006/007/009 will likely have local copies of `Recipe`, `Ingredient`, `Step`, or search payloads, turning a small shared-package setup into a multi-feature refactor with serialization and validation drift to unwind.

---

## Recommended follow-up tasks

1. Revert `001/spec.md`, `001/plan.md`, `001/tasks.md`, and `001/contracts/api.openapi.yaml` to bare `/v1/*`; add `GET /v1/recipes/{id}/instructions`.
2. Remove `POST /recipes/{id}/clone` from 004's public contract/tasks and treat clone as a 001-owned endpoint.
3. Add or refresh `docs/api-conventions.md` (or equivalent) so GR-002 points to one concrete route ownership document.
4. Freeze the initial export list for `@kitchensink/recipe-core` and make it a first-wave 001 setup task before any API or UI implementation.
