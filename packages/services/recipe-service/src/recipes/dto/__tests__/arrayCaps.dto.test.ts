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

import { CreateRecipeDto } from '../createRecipe.dto.js';
import { UpdateRecipeDto } from '../updateRecipe.dto.js';

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
        ingredients: [
            {
                ingredientId: '00000000-0000-4000-8000-0000000000aa',
                name: 'Flour',
                quantity: { kind: 'exact', value: 1 },
            },
        ],
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
        quantity: { kind: 'exact', value: 1 },
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

    it('accepts an EMPTY ingredients array on an update that is not publishing', () => {
        // The draft floor: a draft may be emptied. Rejecting this is what made "remove your last ingredient,
        // then save" impossible — the same defect, one edit later, as Save-Draft-from-step-1.
        expect(update({ ingredients: [] }).ingredients).toEqual([]);
    });
});

/**
 * The publish floor is CONDITIONAL: a recipe may exist empty (a draft), but not be published empty.
 *
 * The pair these replaced asserted a FLAT `min(1)` on both arrays. That read as a cardinality rule and was
 * really a publication rule, so it forbade the empty draft the wizard's Save-Draft is built to create — the
 * app sent `{ ingredients: [], steps: [] }` and the service answered 400.
 */
describe('ingredients/steps cardinality is a PUBLISH floor, not an existence floor', () => {
    it('rejects an empty array on create when status is absent — the server defaults it to published', () => {
        expect(() => create({ ingredients: [] })).toThrow();
        expect(() => create({ steps: [] })).toThrow();
    });

    it('rejects an empty array on create when publishing explicitly', () => {
        expect(() => create({ ingredients: [], status: 'published' })).toThrow();
        expect(() => create({ steps: [], status: 'published' })).toThrow();
    });

    it('ACCEPTS both empty on create when the body says draft', () => {
        const draft = create({ ingredients: [], steps: [], status: 'draft' });

        expect(draft.ingredients).toEqual([]);
        expect(draft.steps).toEqual([]);
    });

    it('rejects an empty array on an update that publishes', () => {
        expect(() => update({ ingredients: [], status: 'published' })).toThrow();
        expect(() => update({ steps: [], status: 'published' })).toThrow();
    });

    it('accepts an update that publishes without resending the arrays — only the service can judge that', () => {
        // Absent means unchanged, and the wire does not carry what is stored, so this MUST pass validation.
        // `RecipesService.update` is what rejects it when the persisted recipe is empty.
        expect(update({ status: 'published' }).status).toBe('published');
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
