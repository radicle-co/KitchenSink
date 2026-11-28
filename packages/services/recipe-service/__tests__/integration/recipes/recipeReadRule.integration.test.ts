/**
 * ADR-0105: a recipe held from readers is read only by its owner, on the detail read, the clone and a write to another
 * cook's recipe. Over the real HTTP pipeline with the DALs MOCKED (`docs/CODING_STANDARDS.md` section 7.1a): the real service
 * and the real in-memory rule, with the hold supplied as the SELECTED field `heldFromReaders` the real DAL computes by
 * `recipe_held_from_readers`. That the database computes it is the LOCAL e2e tier's (`heldFromReaders.e2e.test.ts`).
 *
 * Every refusal carries its control in the same test: the same recipe, not held, IS read; the owner reads the held one.
 */
import 'reflect-metadata';

import { HttpException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { Principal } from '../../../src/auth/principal.js';
import type { ReadableRecipeAggregate } from '../../../src/recipes/dal/recipes.dal.js';
import { RecipeSourceEvidenceDal } from '../../../src/recipes/dal/recipeSourceEvidence.dal.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const OWNER = '01JREADRULEOWNER0000000001';
const READER = '01JREADRULEREADER000000001';
const HELD_ID = '00000000-0000-4000-8000-00000000e101';
const CLEAN_ID = '00000000-0000-4000-8000-00000000e102';
const MISSING_ID = '00000000-0000-4000-8000-00000000e1ff';

function aggregate(id: string, heldFromReaders: boolean): ReadableRecipeAggregate {
    return {
        recipe: {
            ...makeRecipeRow({ id, ownerId: OWNER, visibility: 'public', status: 'published' }),
            heldFromReaders,
        },
        steps: [makeRecipeStepRow({ recipeId: id })],
        ingredients: [],
    };
}

const stored = new Map([
    [HELD_ID, aggregate(HELD_ID, true)],
    [CLEAN_ID, aggregate(CLEAN_ID, false)],
]);

let booted: BootedServiceApp;

function get(id: string, as: string): Promise<Response> {
    return asPrincipal(as, () =>
        fetch(`${booted.baseUrl}/api/v1/recipes/${id}`, { headers: { authorization: bearerFor(as) } }),
    );
}

beforeAll(async () => {
    booted = await bootMockedRecipeApp({
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    findById: (id: string) => Promise.resolve(stored.get(id)),
                    findRowById: (id: string) => Promise.resolve(stored.get(id)?.recipe),
                    privateFoodLines: () => Promise.resolve([]),
                },
            },
            {
                provide: RecipeSourceEvidenceDal,
                useValue: { insert: () => Promise.resolve(undefined), list: () => Promise.resolve([]) },
            },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: () => Promise.resolve([]) } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: () => Promise.resolve(undefined) } },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: {
                    findBandsByKeys: () => Promise.resolve(new Map()),
                    findExistingKeys: () => Promise.resolve(new Set()),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: () => Promise.resolve(undefined) } },
            { provide: AuthorHandlesDal, useValue: { findByline: () => Promise.resolve(undefined) } },
        ],
    });
});

afterAll(async () => {
    await booted.close();
});

describe('detail read of a held public recipe', () => {
    it('answers a non-owner exactly as it answers a missing id, and still reads the controls', async () => {
        const held = await get(HELD_ID, READER);
        const missing = await get(MISSING_ID, READER);
        const heldBody = recipeApiErrorSchema.parse(await held.json());
        const missingBody = recipeApiErrorSchema.parse(await missing.json());

        expect(held.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(JSON.stringify(heldBody).replaceAll(HELD_ID, 'ID')).toBe(
            JSON.stringify(missingBody).replaceAll(MISSING_ID, 'ID'),
        );
        // Controls: the same shape of recipe, not held, is readable by the reader; the owner reads the held one.
        expect((await get(CLEAN_ID, READER)).status).toBe(200);
        expect((await get(HELD_ID, OWNER)).status).toBe(200);
    });
});

describe('the service doors that share the rule', () => {
    const reader: Principal = {
        userId: READER,
        sub: READER,
        scopes: [],
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
    };

    it('findReadableRecipe refuses a non-owner a held recipe, and reads the controls', async () => {
        const service = booted.app.get(RecipesService);

        await expect(service.findReadableRecipe(READER, HELD_ID)).rejects.toMatchObject({ code: 'RECIPE_NOT_FOUND' });
        await expect(service.findReadableRecipe(READER, CLEAN_ID)).resolves.toMatchObject({ id: CLEAN_ID });
        await expect(service.findReadableRecipe(OWNER, HELD_ID)).resolves.toMatchObject({ id: HELD_ID });
    });

    it('clone answers 404 for a held recipe, and a contained test principal gets 404 not 403 (the check order)', async () => {
        const service = booted.app.get(RecipesService);
        const contained: Principal = { ...reader, sub: `test:${READER}`, principalKind: 'test' };

        await expect(service.clone(reader, HELD_ID, undefined)).rejects.toMatchObject({ code: 'RECIPE_NOT_FOUND' });

        const heldRefusal = await service.clone(contained, HELD_ID, undefined).catch((e: unknown) => e);
        const controlRefusal = await service.clone(contained, CLEAN_ID, undefined).catch((e: unknown) => e);

        expect(heldRefusal).toMatchObject({ code: 'RECIPE_NOT_FOUND' });
        // Control: a readable public recipe reaches containment, which refuses a foreign clone.
        expect((controlRefusal as HttpException).getStatus()).toBe(403);
        expect(JSON.stringify((controlRefusal as HttpException).getResponse())).toContain('TEST_PRINCIPAL_CONTAINED');
    });

    it('a write to another cook’s held recipe is the same 404 as for a private one (assertOwner)', async () => {
        const service = booted.app.get(RecipesService);

        await expect(service.findOwnedRecipe(READER, HELD_ID)).rejects.toMatchObject({ code: 'RECIPE_NOT_FOUND' });
        // Control: a readable recipe of another cook is a 403, not a 404.
        await expect(service.findOwnedRecipe(READER, CLEAN_ID)).rejects.toMatchObject({ code: 'NOT_OWNER' });
    });
});
