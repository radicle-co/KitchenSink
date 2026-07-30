/**
 * REQ-003a / REQ-007 — array-size caps on the create/update recipe request bodies.
 *
 * REQ-003a: an authenticated user may attach BETWEEN 1 AND 100 ingredients to a recipe.
 * REQ-007: an authenticated user may attach BETWEEN 0 AND 50 tags/categories to a recipe.
 *
 * Both caps are upper-bound cardinality constraints (`PRF-REQ-034` / `PRF-REQ-035`) that exist to bound
 * request-body size and protect downstream write/filter performance — an unbounded array is an
 * unauthenticated-adjacent cost/DoS surface even behind auth. Pinned through the SAME `ValidationPipe`
 * the controller applies, exactly like the sibling `device-label.dto.test.ts` / `difficulty.dto.test.ts`.
 */
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CreateRecipeDto, type RecipeIngredientInputDto } from '../create-recipe.dto.js';
import { UpdateRecipeDto } from '../update-recipe.dto.js';

/** The exact pipe the `RecipesController` applies (`@UsePipes(new ValidationPipe(...))`). */
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false });

const createMeta: ArgumentMetadata = { type: 'body', metatype: CreateRecipeDto };
const updateMeta: ArgumentMetadata = { type: 'body', metatype: UpdateRecipeDto };

/** A minimal-but-valid create body; `over` layers ingredients/tags (or anything) on top. */
function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Array Caps DTO Recipe',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1 }],
        steps: [{ instruction: 'Mix.' }],
        ...over,
    };
}

/** `count` distinct, individually-valid ingredient lines (REQ-003a operates on array length, not content). */
function makeIngredients(count: number): Pick<RecipeIngredientInputDto, 'ingredientId' | 'name' | 'quantity'>[] {
    return Array.from({ length: count }, (_, i) => ({
        ingredientId: '00000000-0000-4000-8000-000000000001',
        name: `Ingredient ${i}`,
        quantity: 1,
    }));
}

/** `count` distinct tag strings. */
function makeTags(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `tag-${i}`);
}

describe('CreateRecipeDto.ingredients cap (REQ-003a — between 1 and 100)', () => {
    it('accepts exactly 100 ingredients (the upper bound)', async () => {
        const dto = (await pipe.transform(
            createBody({ ingredients: makeIngredients(100) }),
            createMeta,
        )) as CreateRecipeDto;

        expect(dto.ingredients).toHaveLength(100);
    });

    it('rejects 101 ingredients (one past the cap)', async () => {
        await expect(pipe.transform(createBody({ ingredients: makeIngredients(101) }), createMeta)).rejects.toThrow();
    });
});

describe('UpdateRecipeDto.ingredients cap (REQ-003a)', () => {
    it('accepts exactly 100 ingredients on update', async () => {
        const dto = (await pipe.transform(
            { expectedVersion: 1, ingredients: makeIngredients(100) },
            updateMeta,
        )) as UpdateRecipeDto;

        expect(dto.ingredients).toHaveLength(100);
    });

    it('rejects 101 ingredients on update', async () => {
        await expect(
            pipe.transform({ expectedVersion: 1, ingredients: makeIngredients(101) }, updateMeta),
        ).rejects.toThrow();
    });
});

describe('CreateRecipeDto.tags cap (REQ-007 — between 0 and 50)', () => {
    it('accepts exactly 50 tags (the upper bound)', async () => {
        const dto = (await pipe.transform(createBody({ tags: makeTags(50) }), createMeta)) as CreateRecipeDto;

        expect(dto.tags).toHaveLength(50);
    });

    it('rejects 51 tags (one past the cap)', async () => {
        await expect(pipe.transform(createBody({ tags: makeTags(51) }), createMeta)).rejects.toThrow();
    });
});

describe('UpdateRecipeDto.tags cap (REQ-007)', () => {
    it('accepts exactly 50 tags on update', async () => {
        const dto = (await pipe.transform({ expectedVersion: 1, tags: makeTags(50) }, updateMeta)) as UpdateRecipeDto;

        expect(dto.tags).toHaveLength(50);
    });

    it('rejects 51 tags on update', async () => {
        await expect(pipe.transform({ expectedVersion: 1, tags: makeTags(51) }, updateMeta)).rejects.toThrow();
    });
});
