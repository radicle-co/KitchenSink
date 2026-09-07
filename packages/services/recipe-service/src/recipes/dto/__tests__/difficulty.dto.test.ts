/**
 * CR-001 / T152 / FR-001b — request validation for the recipe `difficulty` write field.
 *
 * The crux is the UPDATE body's THREE-STATE contract: an ABSENT field means "leave unchanged", a value means
 * "set it", and an explicit `null` means "clear it back to not-stated". A common bug collapses absent and
 * null — which would either make a set difficulty unclearable or clear it on every partial update — so each
 * of the three is pinned here, run through the SAME `ZodValidationPipe` the controller uses, asserting the
 * parsed body preserves absent-vs-null-vs-value.
 *
 * The `class-validator` version of this suite relied on `@IsOptional()` short-circuiting `null`, and on
 * class-transformer materializing the key so absent-vs-null was told apart by the VALUE. Under zod an absent
 * optional key is genuinely ABSENT from the parsed object, which is a stronger encoding of the same
 * three-state rule — asserted below in both forms so a future change cannot quietly collapse them.
 */
import type { ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';

import { CreateRecipeDto } from '../createRecipe.dto.js';
import { UpdateRecipeDto } from '../updateRecipe.dto.js';

/** The exact pipe the `RecipesController` applies (`@UsePipes(ZodValidationPipe)`). */
const pipe = new ZodValidationPipe();

const createMeta = { type: 'body', metatype: CreateRecipeDto } as ArgumentMetadata;
const updateMeta = { type: 'body', metatype: UpdateRecipeDto } as ArgumentMetadata;

/** A minimal-but-valid create body; `over` layers difficulty (or anything) on top. */
function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Difficulty DTO Recipe',
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
function update(over: Record<string, unknown> = {}): UpdateRecipeDto {
    return pipe.transform({ expectedVersion: 1, ...over }, updateMeta) as UpdateRecipeDto;
}

describe('CreateRecipeDto.difficulty (FR-001b — value-or-omit)', () => {
    it.each(['easy', 'medium', 'hard'])('accepts the enum value %s and keeps it on the parsed body', (value) => {
        expect(create({ difficulty: value }).difficulty).toBe(value);
    });

    it('leaves difficulty undefined when absent (not-stated is a real state, never a default)', () => {
        expect(create().difficulty).toBeUndefined();
    });

    it('rejects a value outside the enum', () => {
        expect(() => create({ difficulty: 'extreme' })).toThrow();
    });

    it('rejects an explicit null on create (no clear sentinel — clearing is an update concern)', () => {
        // On create there is no prior value to clear, so `null` is not a valid difficulty here; only the
        // update body admits the null clear sentinel. `.optional()` (not `.nullable().optional()`) is what
        // enforces that asymmetry.
        expect(() => create({ difficulty: null })).toThrow();
    });
});

describe('UpdateRecipeDto.difficulty (FR-001b — the three-state: omit | value | null)', () => {
    it('omits the KEY entirely when absent → "leave unchanged"', () => {
        const dto = update();

        expect(dto.difficulty).toBeUndefined();
        // Stronger than the value check: under zod the key is genuinely absent, so a DAL that spreads the
        // parsed body can never set `difficulty` to `undefined` by accident.
        expect('difficulty' in dto).toBe(false);
    });

    it.each(['easy', 'medium', 'hard'])('SETS the field to the enum value %s', (value) => {
        expect(update({ difficulty: value }).difficulty).toBe(value);
    });

    it('PRESERVES an explicit null as null → "clear" (distinct from absent)', () => {
        const dto = update({ difficulty: null });

        // The mutation-critical assertion: null must survive validation as a real null, NOT be stripped to
        // undefined (which would collapse "clear" into "leave unchanged") and NOT be dropped as an unknown key.
        expect(dto.difficulty).toBeNull();
        expect('difficulty' in dto).toBe(true);
    });

    it('rejects a value outside the enum', () => {
        expect(() => update({ difficulty: 'extreme' })).toThrow();
    });
});

describe('UpdateRecipeDto does NOT accept visibility (it has a dedicated endpoint)', () => {
    /**
     * ⚠️ THIS ASSERTION USED TO PIN A LIVE BUG, and it is the clearest instance in the service of why GR-017
     * §17-c chose rejection over stripping.
     *
     * `visibility` is set through `PATCH /api/v1/recipes/{id}/visibility`, where the C-004 policy evaluator gates
     * the transition, so this route has always ignored it. The app's own draft→wire projection
     * (`toUpdateRecipeInput`) was SENDING it, the service STRIPPED it, and the previous version of this test
     * asserted the strip — i.e. it pinned the discarded field as correct behaviour. A user who changed a recipe's
     * visibility in the editor and saved had that choice silently dropped, and every layer reported success.
     *
     * Now it is a `400`. The app-side projection was fixed in the same sweep (it no longer sends the field), so
     * this rejection is unreachable from the shipped client — which is the point: if it ever becomes reachable
     * again, the caller finds out.
     */
    it('REFUSES a visibility key instead of silently discarding the caller’s choice', () => {
        expect(() => update({ visibility: 'private' })).toThrow();
    });
});
