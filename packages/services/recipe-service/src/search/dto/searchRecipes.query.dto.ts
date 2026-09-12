/**
 * T043 — query DTO for `GET /api/v1/search/recipes`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../search.schema.ts` (CODING_STANDARDS §15.2 /
 * ADR-0015 §1), matching the sibling `recipes/dto/listRecipes.query.dto.ts`.
 *
 * ⚠️ THIS FILE WAS THE LAST `class-validator` IMPORTER IN `packages/services/**`. What it held — the
 * repeated-or-CSV array normalization, the `INT4_CEILING` on the three time filters, the page-size ceiling and
 * the `sortBy` enum — now lives in `../search.schema.ts`, which is where the wire contract belongs and which is
 * what the published `openapi.yaml` derives its `parameters` from. Three things moved with it, none cosmetic:
 * the rejection now travels the `errors` key so `ApiExceptionFilter` publishes `VALIDATION_FAILED` rather than
 * the unpublished `BAD_REQUEST`; the page-size bound comes from `@kitchensink/recipe-core` rather than from
 * `dal/search.dal.js`; and `INT4_CEILING` is composed rather than re-declared.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata; see `../../recipes/dto/createRecipe.dto.ts`.
 */
import { createZodDto } from 'nestjs-zod';

import { recipeSearchQuerySchema } from '../search.schema.js';

/** Query parameters of `GET /api/v1/search/recipes`. */
export class SearchRecipesQueryDto extends createZodDto(recipeSearchQuerySchema) {}

// `MAX_SEARCH_PAGE_SIZE` is NOT re-exported here — it is a bound, so it lives in `@kitchensink/recipe-core`.
// `RECIPE_SEARCH_SORT_BY` is this endpoint's own wire enum, so it stays authored in `search.schema.ts` and is
// re-exported for the OpenAPI route table.
export { RECIPE_SEARCH_SORT_BY } from '../search.schema.js';
export type { RecipeSearchQuery } from '../search.schema.js';
