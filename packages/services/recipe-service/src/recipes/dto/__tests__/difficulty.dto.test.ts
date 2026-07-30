/**
 * CR-001 / T152 / FR-001b — DTO validation for the recipe `difficulty` write field.
 *
 * The crux is the UPDATE DTO's THREE-STATE contract: an ABSENT field means "leave unchanged", a value
 * means "set it", and an explicit `null` means "clear it back to not-stated". A common bug collapses
 * absent and null — which would either make a set difficulty unclearable or clear it on every partial
 * update — so each of the three is pinned here, run through the SAME `ValidationPipe` the controller uses
 * (`transform + whitelist`), asserting the instance preserves absent-vs-null-vs-value.
 */
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CreateRecipeDto } from '../create-recipe.dto.js';
import { UpdateRecipeDto } from '../update-recipe.dto.js';

/** The exact pipe the `RecipesController` applies (`@UsePipes(new ValidationPipe(...))`). */
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false });

const createMeta: ArgumentMetadata = { type: 'body', metatype: CreateRecipeDto };
const updateMeta: ArgumentMetadata = { type: 'body', metatype: UpdateRecipeDto };

/** A minimal-but-valid create body; `over` layers difficulty (or anything) on top. */
function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Difficulty DTO Recipe',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1 }],
        steps: [{ instruction: 'Mix.' }],
        ...over,
    };
}

describe('CreateRecipeDto.difficulty (FR-001b — value-or-omit)', () => {
    it.each(['easy', 'medium', 'hard'])('accepts the enum value %s and keeps it on the instance', async (value) => {
        const dto = (await pipe.transform(createBody({ difficulty: value }), createMeta)) as CreateRecipeDto;

        expect(dto.difficulty).toBe(value);
    });

    it('leaves difficulty undefined when absent (not-stated is a real state, never a default)', async () => {
        const dto = (await pipe.transform(createBody(), createMeta)) as CreateRecipeDto;

        expect(dto.difficulty).toBeUndefined();
    });

    it('rejects a value outside the enum', async () => {
        await expect(pipe.transform(createBody({ difficulty: 'extreme' }), createMeta)).rejects.toThrow();
    });

    it('rejects an explicit null on create (no clear sentinel — clearing is an update concern)', async () => {
        // On create there is no prior value to clear, so `null` is not a valid difficulty here; only the
        // update DTO admits the null clear sentinel.
        await expect(pipe.transform(createBody({ difficulty: null }), createMeta)).rejects.toThrow();
    });
});

describe('UpdateRecipeDto.difficulty (FR-001b — the three-state: omit | value | null)', () => {
    it('leaves the field undefined when omitted → "leave unchanged"', async () => {
        const dto = (await pipe.transform({ expectedVersion: 1 }, updateMeta)) as UpdateRecipeDto;

        // Absent input → `undefined` value (which the DAL reads as "omit → leave unchanged"). Note the
        // instance always carries the KEY (class-transformer materializes it), so absent-vs-null is told
        // apart by the VALUE (`undefined` vs `null`), never by the `in` operator.
        expect(dto.difficulty).toBeUndefined();
    });

    it.each(['easy', 'medium', 'hard'])('SETS the field to the enum value %s', async (value) => {
        const dto = (await pipe.transform({ expectedVersion: 1, difficulty: value }, updateMeta)) as UpdateRecipeDto;

        expect(dto.difficulty).toBe(value);
    });

    it('PRESERVES an explicit null as null → "clear" (distinct from absent)', async () => {
        const dto = (await pipe.transform({ expectedVersion: 1, difficulty: null }, updateMeta)) as UpdateRecipeDto;

        // The mutation-critical assertion: null must survive validation+transform as a real null, NOT be
        // stripped to undefined (which would collapse "clear" into "leave unchanged").
        expect(dto.difficulty).toBeNull();
    });

    it('rejects a value outside the enum', async () => {
        await expect(pipe.transform({ expectedVersion: 1, difficulty: 'extreme' }, updateMeta)).rejects.toThrow();
    });
});
