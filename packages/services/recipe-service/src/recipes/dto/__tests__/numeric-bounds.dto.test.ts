/**
 * REQ-005a/REQ-005b/REQ-005c/REQ-006 — non-negative time + positive servings coverage.
 *
 * REQ-005a/b/c: prep/cook/total time are each recorded as a NON-NEGATIVE integer number of minutes.
 * REQ-006: servings is recorded as a POSITIVE integer.
 *
 * The enforcement (`@IsInt() @Min(0)` on the three time fields, `@IsInt() @Min(1)` on `servings`, on both
 * `CreateRecipeDto` and `UpdateRecipeDto`) already exists — these are characterization tests closing a
 * V-Model coverage gap, not a behavior change. Pinned through the SAME `ValidationPipe` the controller
 * applies, exactly like the sibling `device-label.dto.test.ts` / `array-caps.dto.test.ts`.
 */
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CreateRecipeDto } from '../create-recipe.dto.js';
import { UpdateRecipeDto } from '../update-recipe.dto.js';

/** The exact pipe the `RecipesController` applies (`@UsePipes(new ValidationPipe(...))`). */
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false });

const createMeta: ArgumentMetadata = { type: 'body', metatype: CreateRecipeDto };
const updateMeta: ArgumentMetadata = { type: 'body', metatype: UpdateRecipeDto };

/** A minimal-but-valid create body; `over` layers the field under test on top. */
function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Numeric Bounds DTO Recipe',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1 }],
        steps: [{ instruction: 'Mix.' }],
        ...over,
    };
}

describe('CreateRecipeDto time fields reject negative minutes (REQ-005a/b/c)', () => {
    it.each(['prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes'])('rejects %s = -1', async (field) => {
        await expect(pipe.transform(createBody({ [field]: -1 }), createMeta)).rejects.toThrow();
    });

    it.each(['prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes'])('accepts %s = 0', async (field) => {
        const dto = (await pipe.transform(createBody({ [field]: 0 }), createMeta)) as CreateRecipeDto;

        expect(dto[field as keyof CreateRecipeDto]).toBe(0);
    });
});

describe('UpdateRecipeDto time fields reject negative minutes (REQ-005a/b/c)', () => {
    it.each(['prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes'])('rejects %s = -1 on update', async (field) => {
        await expect(pipe.transform({ expectedVersion: 1, [field]: -1 }, updateMeta)).rejects.toThrow();
    });
});

describe('CreateRecipeDto.servings rejects non-positive values (REQ-006)', () => {
    it('rejects servings = 0', async () => {
        await expect(pipe.transform(createBody({ servings: 0 }), createMeta)).rejects.toThrow();
    });

    it('rejects servings = -1', async () => {
        await expect(pipe.transform(createBody({ servings: -1 }), createMeta)).rejects.toThrow();
    });

    it('accepts servings = 1 (the lower bound)', async () => {
        const dto = (await pipe.transform(createBody({ servings: 1 }), createMeta)) as CreateRecipeDto;

        expect(dto.servings).toBe(1);
    });
});

describe('UpdateRecipeDto.servings rejects non-positive values (REQ-006)', () => {
    it('rejects servings = 0 on update', async () => {
        await expect(pipe.transform({ expectedVersion: 1, servings: 0 }, updateMeta)).rejects.toThrow();
    });

    it('rejects servings = -1 on update', async () => {
        await expect(pipe.transform({ expectedVersion: 1, servings: -1 }, updateMeta)).rejects.toThrow();
    });
});
