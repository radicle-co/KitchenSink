/**
 * T023 — request DTO for `PATCH /v1/recipes/{id}` (update recipe, optimistic concurrency).
 *
 * Mirrors `UpdateRecipeRequest` in `contracts/api.openapi.yaml`: `expectedVersion` is REQUIRED (the
 * client's last-known `currentVersion`, used for the T033 optimistic-concurrency check); every content
 * field is optional (a partial update). Visibility is set via the dedicated visibility endpoint, so it
 * is intentionally absent here.
 */
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

import { CreateRecipeStepInputDto, RecipeIngredientInputDto } from './create-recipe.dto.js';

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
