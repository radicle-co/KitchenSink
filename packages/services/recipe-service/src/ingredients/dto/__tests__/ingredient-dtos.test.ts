/**
 * T029 — validation-outcome tests for the ingredient request DTOs, run through the EXACT
 * `ValidationPipe` the `IngredientsController` applies (`transform + whitelist`). These pin the
 * boundary semantics that previously lived in the controller's hand-rolled `requireName` /
 * `requireCandidateIds` and now live on the DTOs: trim-before-validate, non-blank, length/size bounds,
 * element typing, and whitelist-stripping of spoofed fields. A mutation that dropped a validator (or the
 * trim) surfaces here as an accepted-instead-of-rejected (or un-trimmed) case.
 */
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CreateIngredientDto } from '../create-ingredient.dto.js';
import { ResolveIngredientDto } from '../resolve-ingredient.dto.js';

/** The exact pipe the `IngredientsController` applies (`@UsePipes(new ValidationPipe(...))`). */
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false });

const createMeta: ArgumentMetadata = { type: 'body', metatype: CreateIngredientDto };
const resolveMeta: ArgumentMetadata = { type: 'body', metatype: ResolveIngredientDto };

describe('CreateIngredientDto (POST /v1/ingredients and /by-name)', () => {
    it('trims a valid name and exposes the trimmed value on the instance', async () => {
        const dto = (await pipe.transform({ name: '  Grandma spice  ' }, createMeta)) as CreateIngredientDto;

        expect(dto.name).toBe('Grandma spice');
    });

    it('accepts a name exactly at the 120-char bound', async () => {
        const dto = (await pipe.transform({ name: 'x'.repeat(120) }, createMeta)) as CreateIngredientDto;

        expect(dto.name).toHaveLength(120);
    });

    it('strips a spoofed non-DTO field (whitelist)', async () => {
        const dto = (await pipe.transform(
            { name: 'Flour', ownerId: 'attacker', isUserEntered: false },
            createMeta,
        )) as CreateIngredientDto & Record<string, unknown>;

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
    ])('rejects %s with 400', async (_label, body) => {
        await expect(pipe.transform(body, createMeta)).rejects.toThrow();
    });
});

describe('ResolveIngredientDto (POST /v1/ingredients/{id}/resolve)', () => {
    it('trims each picked candidate id and exposes the trimmed array on the instance', async () => {
        const dto = (await pipe.transform(
            { candidateIds: ['  cand-1  ', 'cand-2'] },
            resolveMeta,
        )) as ResolveIngredientDto;

        expect(dto.candidateIds).toEqual(['cand-1', 'cand-2']);
    });

    it('accepts a full array at the 20-id cap', async () => {
        const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
        const dto = (await pipe.transform({ candidateIds: ids }, resolveMeta)) as ResolveIngredientDto;

        expect(dto.candidateIds).toHaveLength(20);
    });

    it.each([
        ['a missing candidateIds', {}],
        ['a non-array candidateIds', { candidateIds: 'cand-1' }],
        ['an empty candidateIds', { candidateIds: [] }],
        ['a blank-after-trim id', { candidateIds: ['  '] }],
        ['a non-string id', { candidateIds: [42] }],
        ['an oversized (21-id) array', { candidateIds: Array.from({ length: 21 }, (_, i) => `c${i}`) }],
    ])('rejects %s with 400', async (_label, body) => {
        await expect(pipe.transform(body, resolveMeta)).rejects.toThrow();
    });
});
