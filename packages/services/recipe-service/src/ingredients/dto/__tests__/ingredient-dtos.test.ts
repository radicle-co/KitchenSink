/**
 * T029 — validation-outcome tests for the ingredient request DTOs, run through the EXACT `ZodValidationPipe`
 * the `IngredientsController` applies. These pin the boundary semantics that previously lived in the
 * controller's hand-rolled `requireName` / `requireCandidateIds`, then on `class-validator` decorators, and now
 * on the AUTHORED zod the published contract is generated from: trim-before-validate, non-blank, length/size
 * bounds, element typing, and the stripping of spoofed fields. A mutation that dropped a rule (or the trim)
 * surfaces here as an accepted-instead-of-rejected (or un-trimmed) case.
 *
 * THE SEMANTICS ARE UNCHANGED BY THE SWAP, which is the point — every case below is the one it was under
 * `class-validator`, including the whitelist strip, which is now `z.object`'s default rather than an option.
 * Two mechanical differences: the pipe is SYNCHRONOUS (so a rejection is a `throw`, not a rejected promise),
 * and it returns the PARSED OBJECT rather than a class instance, so these read properties off a plain object.
 */
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ArgumentMetadata } from '@nestjs/common';

import { AddIngredientByFoodDto } from '../add-ingredient-by-food.dto.js';
import { CreateIngredientDto } from '../create-ingredient.dto.js';
import { ResolveIngredientDto } from '../resolve-ingredient.dto.js';

/** The exact pipe the `IngredientsController` applies (`@UsePipes(ZodValidationPipe)`). */
const pipe = new ZodValidationPipe();

/** Parse a body through the pipe for the given DTO, as the framework would. */
function parse<T>(body: unknown, meta: ArgumentMetadata): T {
    return pipe.transform(body, meta) as T;
}

/** The HTTP status a rejected body produces, or `undefined` when it was accepted. */
function statusOfRejection(body: unknown, meta: ArgumentMetadata): number | undefined {
    try {
        pipe.transform(body, meta);

        return undefined;
    } catch (error: unknown) {
        return (error as { getStatus: () => number }).getStatus();
    }
}

const createMeta: ArgumentMetadata = { type: 'body', metatype: CreateIngredientDto };
const resolveMeta: ArgumentMetadata = { type: 'body', metatype: ResolveIngredientDto };
const byFoodMeta: ArgumentMetadata = { type: 'body', metatype: AddIngredientByFoodDto };

describe('AddIngredientByFoodDto (POST /api/v1/ingredients/by-food — Stage 2 pick)', () => {
    it('trims a valid food id and exposes the trimmed value on the instance', () => {
        const dto = parse({ foodId: '  01J0000000000000000000FOOD  ' }, byFoodMeta) as AddIngredientByFoodDto;

        expect(dto.foodId).toBe('01J0000000000000000000FOOD');
    });

    it('STRIPS a caller-supplied name — the display name comes from food-service, never the client', () => {
        const dto = parse(
            { foodId: '01J0FOOD', name: 'Definitely not chicken' },
            byFoodMeta,
        ) as AddIngredientByFoodDto & Record<string, unknown>;

        expect(dto.foodId).toBe('01J0FOOD');
        expect(dto['name']).toBeUndefined();
    });

    it.each([
        ['a missing food id', {}],
        ['a blank (whitespace-only) food id', { foodId: '   ' }],
        ['a non-string food id', { foodId: 42 }],
        ['an over-long food id (65 after trim)', { foodId: 'x'.repeat(65) }],
    ])('rejects %s with 400', (_label, body) => {
        expect(statusOfRejection(body, byFoodMeta)).toBe(400);
    });
});

describe('CreateIngredientDto (POST /api/v1/ingredients and /by-name)', () => {
    it('trims a valid name and exposes the trimmed value on the instance', () => {
        const dto = parse<CreateIngredientDto>({ name: '  Grandma spice  ' }, createMeta);

        expect(dto.name).toBe('Grandma spice');
    });

    it('accepts a name exactly at the 120-char bound', () => {
        const dto = parse<CreateIngredientDto>({ name: 'x'.repeat(120) }, createMeta);

        expect(dto.name).toHaveLength(120);
    });

    it('strips a spoofed non-DTO field (whitelist)', () => {
        const dto = parse(
            { name: 'Flour', ownerId: 'attacker', isUserEntered: false },
            createMeta,
        ) as CreateIngredientDto & Record<string, unknown>;

        expect(dto.name).toBe('Flour');
        expect(dto['ownerId']).toBeUndefined();
        expect(dto['isUserEntered']).toBeUndefined();
    });

    it.each([
        ['a missing name', {}],
        ['a blank (whitespace-only) name', { name: '   ' }],
        ['a non-string name', { name: 123 }],
        ['an over-long name (121 after trim)', { name: 'x'.repeat(121) }],
        ['an over-long name whose length survives trimming', { name: `  ${'x'.repeat(121)}  ` }],
    ])('rejects %s with 400', (_label, body) => {
        expect(statusOfRejection(body, createMeta)).toBe(400);
    });
});

describe('ResolveIngredientDto (POST /api/v1/ingredients/{id}/resolve)', () => {
    it('trims each picked candidate id and exposes the trimmed array on the instance', () => {
        const dto = parse({ candidateIds: ['  cand-1  ', 'cand-2'] }, resolveMeta) as ResolveIngredientDto;

        expect(dto.candidateIds).toEqual(['cand-1', 'cand-2']);
    });

    it('accepts a full array at the 20-id cap', async () => {
        const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
        const dto = parse<ResolveIngredientDto>({ candidateIds: ids }, resolveMeta);

        expect(dto.candidateIds).toHaveLength(20);
    });

    it.each([
        ['a missing candidateIds', {}],
        ['a non-array candidateIds', { candidateIds: 'cand-1' }],
        ['an empty candidateIds', { candidateIds: [] }],
        ['a blank-after-trim id', { candidateIds: ['  '] }],
        ['a non-string id', { candidateIds: [42] }],
        ['an oversized (21-id) array', { candidateIds: Array.from({ length: 21 }, (_, i) => `c${i}`) }],
    ])('rejects %s with 400', (_label, body) => {
        expect(statusOfRejection(body, resolveMeta)).toBe(400);
    });
});
