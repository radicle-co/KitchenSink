/**
 * T023 — query DTO for `GET /api/v1/recipes` (list the caller's recipes with pagination).
 *
 * Mirrors the `Page`/`PageSize` parameters + the `sortBy` enum in `contracts/api.openapi.yaml`:
 * `page` ≥ 1 (default 1), `pageSize` in 1..100 (default 20), `sortBy` ∈ {updatedAt, createdAt, title}
 * (default updatedAt). Query strings are coerced to numbers by the controller-scoped `ValidationPipe`
 * (`transform: true` + `@Type(() => Number)`).
 */
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Supported list sort keys (contract `sortBy` enum). */
export const RECIPE_LIST_SORT_BY = ['updatedAt', 'createdAt', 'title'] as const;

/** A list sort key. */
export type RecipeListSortBy = (typeof RECIPE_LIST_SORT_BY)[number];

/** Query parameters of `GET /api/v1/recipes`. */
export class ListRecipesQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize: number = 20;

    @IsOptional()
    @IsIn(RECIPE_LIST_SORT_BY)
    sortBy: RecipeListSortBy = 'updatedAt';
}
