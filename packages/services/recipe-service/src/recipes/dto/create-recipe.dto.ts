/**
 * T023 — request DTO for `POST /v1/recipes` (create recipe).
 *
 * Mirrors the `CreateRecipeRequest` schema in `contracts/api.openapi.yaml`: title/servings/times are
 * required, ingredients and steps carry at least one item, and visibility defaults to `public`. The
 * recipes vertical persists the golden `recipes` row + its ordered `recipe_steps` and the denormalized
 * `ingredient_names_text`; the relational ingredient rows are owned by the ingredients vertical.
 * Validation runs via the controller-scoped `ValidationPipe`.
 */
import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { RecipeDifficulty, RecipeVisibility } from '@kitchensink/recipe-core';

/** The allowed visibility literals, derived from the shared `RecipeVisibility` value object. */
const RECIPE_VISIBILITIES = Object.values(RecipeVisibility);

/**
 * The allowed difficulty literals (`easy`/`medium`/`hard`), derived from the shared `RecipeDifficulty`
 * value object. Exported so the update DTO validates against the exact same set (one authoritative list).
 */
export const RECIPE_DIFFICULTIES = Object.values(RecipeDifficulty);

/** A single ingredient line on a create/update request (wire shape of the domain `RecipeIngredient`). */
export class RecipeIngredientInputDto {
    @IsUUID()
    ingredientId!: string;

    @IsString()
    @MaxLength(120)
    name!: string;

    // Bounded to the `recipe_ingredients.quantity numeric(10,3)` column + its `CHECK (quantity > 0)`:
    // the minimum is one representable step at scale 3 (values below round to 0.000 and violate the
    // check), and the maximum stays well under the 7-integer-digit precision (values at/above overflow
    // with SQLSTATE 22003). Both previously surfaced as an uncaught 500 that aborted the whole recipe tx.
    @IsNumber()
    @Min(0.001)
    @Max(1_000_000)
    quantity!: number;

    @IsOptional()
    @IsString()
    unit?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    // Per-line user-entered nutrition override (FR-007a) — absolute for this line's quantity. Optional,
    // and typically set only for freeform/user-entered ingredients whose food resolution has no data.
    @IsOptional()
    @IsNumber()
    @Min(0)
    userCalories?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    userProteinG?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    userCarbsG?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    userFatG?: number;
}

/** A single instruction step; the server assigns `stepNumber` from array order (`CreateRecipeStepInput`). */
export class CreateRecipeStepInputDto {
    @IsString()
    instruction!: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    timerSeconds?: number;
}

/** Body of `POST /v1/recipes`. */
export class CreateRecipeDto {
    @IsString()
    @MaxLength(200)
    title!: string;

    @IsOptional()
    @IsString()
    @MaxLength(5000)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    cuisine?: string;

    // Author-stated difficulty (FR-001b). OPTIONAL with NO default: an omitted field means "the author
    // stated none", a first-class state the DB stores as NULL. Deliberately `@ValidateIf(absent-skip)` and
    // NOT `@IsOptional()`: `@IsOptional()` short-circuits on `null` too, which would let a client send
    // `null` on create — but create is value-or-OMIT (the OpenAPI create schema is non-nullable; the null
    // CLEAR sentinel is an UPDATE-only concern). `@ValidateIf` skips validation only when the field is
    // truly absent (undefined), so `@IsIn` still runs for `null` and REJECTS it, while a genuine omit passes.
    @ValidateIf((dto: CreateRecipeDto) => dto.difficulty !== undefined)
    @IsIn(RECIPE_DIFFICULTIES)
    difficulty?: RecipeDifficulty;

    @IsOptional()
    @IsIn(RECIPE_VISIBILITIES)
    visibility?: RecipeVisibility;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => RecipeIngredientInputDto)
    ingredients!: RecipeIngredientInputDto[];

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateRecipeStepInputDto)
    steps!: CreateRecipeStepInputDto[];

    @IsInt()
    @Min(1)
    servings!: number;

    @IsInt()
    @Min(0)
    prepTimeMinutes!: number;

    @IsInt()
    @Min(0)
    cookTimeMinutes!: number;

    @IsInt()
    @Min(0)
    totalTimeMinutes!: number;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    dietaryFlags?: string[];
}
