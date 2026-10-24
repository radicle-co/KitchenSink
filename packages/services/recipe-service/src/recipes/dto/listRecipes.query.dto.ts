/**
 * Query DTO for `GET /api/v1/recipes` (list the caller's recipes with pagination).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../recipes.schema.ts` (CODING_STANDARDS §15.2):
 * `page` ≥ 1 (default 1), `pageSize` in 1..100 (default 20), `sortBy` ∈ {updatedAt, createdAt, title}
 * (default updatedAt). Query-string values arrive as strings, so the schema coerces — `z.coerce.number()`
 * replaces what `@Type(() => Number)` did, and `.int()` REJECTS `2.5` rather than truncating it.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata; see `createRecipe.dto.ts`.
 */
import { createZodDto } from 'nestjs-zod';

import { listRecipesQuerySchema } from '../recipes.schema.js';

/** Query parameters of `GET /api/v1/recipes`. */
export class ListRecipesQueryDto extends createZodDto(listRecipesQuerySchema) {}

// `MAX_RECIPE_LIST_PAGE_SIZE` is NOT re-exported here — it is a bound, so it lives in
// `@kitchensink/recipe-core`. `RECIPE_LIST_SORT_BY` is this endpoint's own wire enum, so it stays authored
// in `recipes.schema.ts` and is re-exported for the controller and the OpenAPI route table.
export { RECIPE_LIST_SORT_BY } from '../recipes.schema.js';
export type { RecipeListSortBy } from '../recipes.schema.js';
