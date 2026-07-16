/**
 * T023 — request DTO for `PATCH /v1/recipes/{id}` (update recipe, optimistic concurrency).
 *
 * Mirrors `UpdateRecipeRequest` in `contracts/api.openapi.yaml`: `expectedVersion` is REQUIRED (the
 * client's last-known `currentVersion`, used for the T033 optimistic-concurrency check); every content
 * field is optional (a partial update). Visibility is set via the dedicated visibility endpoint, so it
 * is intentionally absent here.
 */
import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import type { RecipeDifficulty } from '@kitchensink/recipe-core';

import { CreateRecipeStepInputDto, RECIPE_DIFFICULTIES, RecipeIngredientInputDto } from './create-recipe.dto.js';

/** Body of `PATCH /v1/recipes/{id}`. */
export class UpdateRecipeDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(5000)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    cuisine?: string;

    /**
     * Author-stated difficulty (FR-001b) — THREE distinct, non-interchangeable states:
     *   - the property ABSENT   → leave unchanged (the standard partial-update semantic);
     *   - a value (easy/…)      → set it;
     *   - explicit `null`       → CLEAR it back to "not stated".
     *
     * `@IsOptional()` short-circuits validation for BOTH `undefined` and `null`, so an explicit `null`
     * passes (it is the clear sentinel), while `@IsIn` still rejects any non-null value outside the enum.
     * class-transformer preserves the distinction on the instance: an absent key stays `undefined`, an
     * explicit `null` stays `null` — which the service/DAL rely on to tell "leave" from "clear". Pinned by
     * the DTO validation tests and the DAL/integration clear-vs-unchanged tests.
     */
    @IsOptional()
    @IsIn(RECIPE_DIFFICULTIES)
    difficulty?: RecipeDifficulty | null;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => RecipeIngredientInputDto)
    ingredients?: RecipeIngredientInputDto[];

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateRecipeStepInputDto)
    steps?: CreateRecipeStepInputDto[];

    @IsOptional()
    @IsInt()
    @Min(1)
    servings?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    prepTimeMinutes?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    cookTimeMinutes?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    totalTimeMinutes?: number;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    dietaryFlags?: string[];
}
