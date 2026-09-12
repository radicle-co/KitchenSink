# Codebase Analysis — 004 Recipe Importing

**Regenerated**: 2026-08-02
**Method**: direct inspection of `main` at `50d5a1fb`, not inference from documentation.

> **Regeneration note.** The previous analysis was written before feature 001 merged (PR #73, 2026-07-30) and
> described a codebase that no longer exists. It named `packages/apps/commise/{web,mobile}` correctly but knew
> nothing of the shipped recipe service, and it is the reason downstream artefacts targeted
> `packages/api/recipe/` — a directory that contains only `.gitkeep`.

## Where recipe code actually lives

| Concern                        | Package                                  | Notes                                             |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------- |
| Recipe HTTP service (NestJS)   | `packages/services/recipe-service`       | `@kitchensink/recipe-service`                     |
| Recipe domain types & policies | `packages/shared/recipe-core`            | `@kitchensink/recipe-core` — pure, cross-platform |
| Typed service client           | `packages/clients/recipe-service`        | `@kitchensink/recipe-service-client`              |
| Async workers                  | `packages/services/recipe-workers`       | `@kitchensink/recipe-workers`                     |
| Recipe feature UI              | `packages/apps/commise/features/recipes` | `@commise/features-recipes`                       |
| Web app                        | `packages/apps/commise/web`              | `@commise/web`                                    |
| Mobile app                     | `packages/apps/commise/mobile`           | `@commise/mobile`                                 |
| Localization                   | `packages/apps/commise/i18n`             | `@commise/i18n` — `useMessages`                   |
| Load testing                   | `packages/tools/loadtest`                | k6 scripts (`journey.js`, `ratelimit.js`)         |

`packages/api/` exists but holds only `.gitkeep`. **No code belongs there.**

## What 001 already shipped that 004 must consume

Verified by reading the source, not the spec:

| Capability                                                                                         | Location                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `recipes.source_type` (4-value domain incl. `imported_public`/`imported_physical`/`imported_paid`) | `src/database/schema/recipes.ts`                           |
| `recipes.source_url`, `source_attribution`, `cloned_from_id`, `has_substantive_edit`               | same — since `0001_initial.sql`                            |
| C-004 visibility policy `evaluateVisibility(sourceType, isPremium, hasSubstantiveEdit, requested)` | `@kitchensink/recipe-core`                                 |
| `canClone`, `canGoPrivate`                                                                         | `recipe-core/src/recipeAccessPolicy.ts`                    |
| Clone endpoint `POST /api/v1/recipes/{id}/clone`                                                   | `src/recipes/recipes.controller.ts` + `recipes.service.ts` |
| Error envelope `{code,message,details?}` + `RecipeErrorCode` → HTTP map                            | `src/common/filters/apiException.filter.ts`                |
| Typed domain errors (`Object.setPrototypeOf` + `is*` guard)                                        | `src/recipes/recipe.error.ts`                              |
| Per-user rate limiting                                                                             | `src/common/throttle/` (`@nestjs/throttler`)               |
| Zod validation pipe                                                                                | `src/common/pipes/zod-validation.pipe.ts`                  |
| OpenAPI contract                                                                                   | `specs/001-commise-recipe-app/contracts/api.openapi.yaml`  |

**Implication**: 004's scope is ingestion only. Attribution storage, cloning, and visibility enforcement are
done. Rebuilding any of them would fork a shipped rule.

## Constraints the shipped schema imposes on import

These were **not** identified in the previous analysis and they reshape the whole feature:

| Constraint                                                                     | Consequence for import                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `servings`, `prep/cook/total_time_minutes` are `NOT NULL` integers with CHECKs | Extraction cannot guarantee them → draft-and-confirm required |
| `recipe_ingredients.quantity numeric(10,3) CHECK (> 0)`                        | Free-text ingredient lines must be **parsed**, not stored raw |
| `CreateRecipeRequest` requires ≥1 ingredient and ≥1 step                       | An empty extraction cannot be persisted at all                |
| Ingredients resolve asynchronously via `food_resolution_status`                | Import must use the shipped lifecycle, not invent one         |
| `recipes.id` is `uuid`; `owner_id` is the **app ULID**                         | `principal.userId` is the ULID, never the Clerk `sub`         |
| No unique index on `source_url` today                                          | Dedup needs a new partial unique index, not a new column      |
| Latest migration is `0018`                                                     | 004 starts at `0019`                                          |

## API path shape after ADR-0011

Every shipped controller now declares **both** paths, canonical first — e.g.
`@Controller(['api/v1/recipes', 'v1/recipes'])`. `/api/{version}/*` is canonical; the bare `/{version}/*` is a
**deprecated alias kept deliberately** for consumers outside this repo (the Clerk-registered webhook, shipped
mobile builds with baked-in endpoints, cross-service erasure calls). `/health` stays unprefixed at the root.
004 uses the canonical form only, and must not remove the alias.

## Conventions 004 must follow

- **File naming** (CI-enforced by `eslint-plugin-check-file`): backend kebab `name.type.ts`; `packages/shared`,
  `packages/clients`, `packages/apps` use camelCase modules / PascalCase components.
- **Tests**: unit in co-located `__tests__/*.test.ts`; integration via `vitest.integration.config.ts`; e2e in
  `tests/e2e/*.e2e.test.ts`. Mutation testing via the configured `stryker`.
- **Cross-platform**: `.native.tsx` siblings with identical public APIs; never `.mobile.*`.
- **Localization**: `messages.ts` per feature package, consumed through `useMessages` on both platforms.
- **Env vars**: bracket notation only.

## Reusable assets 004 should not rebuild

`@kitchensink/service-test-harness` (e2e boot), `@kitchensink/food-service-client` (ingredient resolution),
`packages/tools/loadtest` (k6 conventions incl. per-VU token refresh), `sharp` and `file-type` (already
dependencies of the recipe service), and the shipped photo-upload/S3 pattern in `src/photos/`.
