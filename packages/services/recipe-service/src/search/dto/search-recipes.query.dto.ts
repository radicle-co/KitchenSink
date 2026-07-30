/**
 * T043 — query DTO for `GET /v1/search/recipes`.
 *
 * Mirrors the shared `RecipeSearchParams` contract (`@kitchensink/recipe-core`). Query-string values
 * arrive as strings, so numeric fields are coerced with `@Type(() => Number)` and array fields
 * (`dietaryFlags` / `tags` / `ingredientIds`) accept EITHER repeated params (`?tags=a&tags=b`) OR a
 * single comma-separated value (`?tags=a,b`), normalized to a trimmed `string[]` by `@Transform`. The
 * controller-scoped `ValidationPipe` (`transform: true`) applies these. `page`/`pageSize`/`sortBy` are
 * left optional here and defaulted in {@link SearchService} so the wire contract stays a pure subset.
 */
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import type { RecipeSearchParams, RecipeSearchSortBy as RecipeSearchSortByType } from '@kitchensink/recipe-core';

import { MAX_SEARCH_PAGE_SIZE } from '../dal/search.dal.js';

/**
 * The `sortBy` values accepted on the wire — derived from the shared {@link RecipeSearchSortBy} value object
 * (single source), so a new search sort (W8-a.9 added `most-cloned` + `quickest`) is admitted by adding it to
 * the enum, with no second list to keep in lockstep here.
 */
const SEARCH_SORT_BY = Object.values(RecipeSearchSortBy);

/** Normalize a repeated-or-CSV query param into a trimmed, non-empty `string[]` (or `undefined`). Pure. */
function toStringArray(value: unknown): string[] | undefined {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    const normalized = raw
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    return normalized.length > 0 ? normalized : undefined;
}

/** Query parameters of `GET /v1/search/recipes` (a wire projection of `RecipeSearchParams`). */
export class SearchRecipesQueryDto implements RecipeSearchParams {
    @IsOptional()
    @IsString()
    query?: string;

    @IsOptional()
    @IsString()
    cuisine?: string;

    @IsOptional()
    @Transform(({ value }) => toStringArray(value))
    @IsArray()
    @IsString({ each: true })
    dietaryFlags?: string[];

    @IsOptional()
    @Transform(({ value }) => toStringArray(value))
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    maxPrepTime?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    maxCookTime?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    maxTotalTime?: number;

    @IsOptional()
    @Transform(({ value }) => toStringArray(value))
    @IsArray()
    @IsString({ each: true })
    ingredientIds?: string[];

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_SEARCH_PAGE_SIZE)
    pageSize?: number;

    @IsOptional()
    @IsIn(SEARCH_SORT_BY)
    sortBy?: RecipeSearchSortByType;
}
