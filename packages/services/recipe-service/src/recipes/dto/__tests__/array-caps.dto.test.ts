/**
 * REQ-003a / REQ-007 — array-size caps on the create/update recipe request bodies.
 *
 * REQ-003a: an authenticated user may attach BETWEEN 1 AND 100 ingredients to a recipe.
 * REQ-007: an authenticated user may attach BETWEEN 0 AND 50 tags/categories to a recipe.
 *
 * Both caps are cardinality constraints (`PRF-REQ-034` / `PRF-REQ-035`) that exist to bound request-body size
 * and protect downstream write/filter performance — an unbounded array is an unauthenticated-adjacent
 * cost/DoS surface even behind auth. Pinned through the SAME `ZodValidationPipe` the controller applies.
 *
 * Both the LOWER and the UPPER bound matter and both are pinned: the `.min(1)` on `ingredients`/`steps` was
 * `@ArrayMinSize(1)` before the §15.2 convergence and was ABSENT from `recipe-core`'s published request zod,
 * so a naive swap to that schema would have started accepting a recipe with no ingredients and no steps.
 */
import type { ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';

import { MAX_RECIPE_INGREDIENTS, MAX_RECIPE_TAGS } from '@kitchensink/recipe-core';

import { CreateRecipeDto } from '../create-recipe.dto.js';
import { UpdateRecipeDto } from '../update-recipe.dto.js';

/** The exact pipe the `RecipesController` applies (`@UsePipes(ZodValidationPipe)`). */
const pipe = new ZodValidationPipe();

const createMeta = { type: 'body', metatype: CreateRecipeDto } as ArgumentMetadata;
const updateMeta = { type: 'body', metatype: UpdateRecipeDto } as ArgumentMetadata;

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

/** Parse a create body through the real pipe. */
function create(over: Record<string, unknown> = {}): CreateRecipeDto {
    return pipe.transform(createBody(over), createMeta) as CreateRecipeDto;
}

/** Parse an update body through the real pipe. */
function update(over: Record<string, unknown>): UpdateRecipeDto {
    return pipe.transform({ expectedVersion: 1, ...over }, updateMeta) as UpdateRecipeDto;
}

/** `count` individually-valid ingredient lines (REQ-003a operates on array length, not content). */
function makeIngredients(count: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_, index) => ({
        ingredientId: '00000000-0000-4000-8000-000000000001',
        name: `Ingredient ${index}`,
        quantity: 1,
    }));
}

/** `count` distinct tag strings. */
function makeTags(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `tag-${index}`);
}

describe('CreateRecipeDto.ingredients cap (REQ-003a — between 1 and 100)', () => {
    it('the published cap is 100', () => {
        expect(MAX_RECIPE_INGREDIENTS).toBe(100);
    });

    it('accepts exactly 100 ingredients (the upper bound)', () => {
        expect(create({ ingredients: makeIngredients(MAX_RECIPE_INGREDIENTS) }).ingredients).toHaveLength(100);
    });

    it('rejects 101 ingredients (one past the cap)', () => {
        expect(() => create({ ingredients: makeIngredients(MAX_RECIPE_INGREDIENTS + 1) })).toThrow();
    });

    it('rejects an EMPTY ingredients array (the lower bound recipe-core did not carry)', () => {
        expect(() => create({ ingredients: [] })).toThrow();
    });
});

describe('UpdateRecipeDto.ingredients cap (REQ-003a)', () => {
    it('accepts exactly 100 ingredients on update', () => {
        expect(update({ ingredients: makeIngredients(MAX_RECIPE_INGREDIENTS) }).ingredients).toHaveLength(100);
    });

    it('rejects 101 ingredients on update', () => {
        expect(() => update({ ingredients: makeIngredients(MAX_RECIPE_INGREDIENTS + 1) })).toThrow();
    });

    it('rejects an EMPTY ingredients array on update — omit the key to leave them unchanged', () => {
        expect(() => update({ ingredients: [] })).toThrow();
    });
});

describe('steps cardinality', () => {
    it('rejects an EMPTY steps array on create and on update', () => {
        expect(() => create({ steps: [] })).toThrow();
        expect(() => update({ steps: [] })).toThrow();
    });
});

describe('CreateRecipeDto.tags cap (REQ-007 — between 0 and 50)', () => {
    it('the published cap is 50', () => {
        expect(MAX_RECIPE_TAGS).toBe(50);
    });

    it('accepts exactly 50 tags (the upper bound)', () => {
        expect(create({ tags: makeTags(MAX_RECIPE_TAGS) }).tags).toHaveLength(50);
    });

    it('rejects 51 tags (one past the cap)', () => {
        expect(() => create({ tags: makeTags(MAX_RECIPE_TAGS + 1) })).toThrow();
    });

    it('accepts an EMPTY tags array — REQ-007 says between 0 and 50', () => {
        expect(create({ tags: [] }).tags).toEqual([]);
    });

    it('rejects an empty-string tag, matching the min(1) every read schema enforces', () => {
        expect(() => create({ tags: ['ok', ''] })).toThrow();
    });
});

describe('UpdateRecipeDto.tags cap (REQ-007)', () => {
    it('accepts exactly 50 tags on update', () => {
        expect(update({ tags: makeTags(MAX_RECIPE_TAGS) }).tags).toHaveLength(50);
    });

    it('rejects 51 tags on update', () => {
        expect(() => update({ tags: makeTags(MAX_RECIPE_TAGS + 1) })).toThrow();
    });
});

describe('dietaryFlags', () => {
    it('accepts an empty array and rejects an empty-string member', () => {
        expect(create({ dietaryFlags: [] }).dietaryFlags).toEqual([]);
        expect(() => create({ dietaryFlags: [''] })).toThrow();
    });
});
