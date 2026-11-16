/**
 * What `RecipesService` writes into the attestation record (migration 0088), through its real save paths over fake
 * collaborators. The row-building rules have their own table in `statementAttestation.test.ts`; these cases are the wiring:
 * which rows reach the DAL, with which owner, and when none do.
 */
import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_CONFIRMATION_FOR_API_WRITERS, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeRecipeRow } from '../../__fixtures__/index.js';
import type { Principal } from '../../auth/principal.js';
import { makeRootArm, fakeFoodLookupsDal } from '../../ingredients/__fixtures__/foodLookups.fixture.js';
import { fakeRecipesDal, FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import { makeRecipesService } from '../__fixtures__/recipesService.fixture.js';
import type { RecipeAggregate } from '../dal/recipes.dal.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import { resolveStatementProvenance } from '../domain/provenancePolicy.js';

const OWNER = '01JATTESTATIONS0000000OWNER';
const PRINCIPAL: Principal = {
    userId: OWNER,
    sub: 'user_clerk',
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
};
const FLOUR = makeRootArm({ lookupId: '00000000-0000-4000-8000-0000000000a1', foodId: 'food-flour' });
const LOOKUPS = fakeFoodLookupsDal(FLOUR);
const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;

const DTO: CreateRecipeDto = {
    title: 'Pancakes',
    cuisine: 'American',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    status: 'draft',
    visibility: RecipeVisibility.PRIVATE,
    ingredients: [{ ingredientId: FLOUR.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'g' }],
    steps: [{ instruction: 'Mix' }],
};

function setup(stored: RecipeAggregate | undefined = undefined) {
    const aggregate = stored ?? { recipe: makeRecipeRow({ ownerId: OWNER }), ingredients: [], steps: [] };
    const insertMany = vi.fn(async () => undefined);
    const dal = fakeRecipesDal({
        create: vi.fn().mockResolvedValue(aggregate),
        findById: vi.fn().mockResolvedValue(aggregate),
        update: vi.fn().mockResolvedValue(aggregate),
    });
    const service = makeRecipesService({ dal, lookups: LOOKUPS, attestations: { insertMany } });

    return { insertMany, service };
}

describe('RecipesService.create — the attestation record', () => {
    it('writes the explicit row in the create transaction, owned by the acting principal', async () => {
        const { insertMany, service } = setup();

        await service.create(PRINCIPAL, { ...DTO, statement: AUTHORED }, undefined);

        expect(insertMany).toHaveBeenCalledTimes(1);
        expect(insertMany).toHaveBeenCalledWith(FAKE_TX, [
            expect.objectContaining({
                accountId: OWNER,
                mode: 'explicit',
                choice: 'authored',
                action: 'create',
                wordingVersion: 'statementAuthored.v1',
                locale: 'en',
            }),
        ]);
    });

    it('writes nothing for a save that states and confirms nothing', async () => {
        const { insertMany, service } = setup();

        await service.create(PRINCIPAL, DTO, undefined);

        expect(insertMany).not.toHaveBeenCalled();
    });

    it('⛔ the bulk import is exempt: it writes no row, even when the request body carries a confirmation', async () => {
        const { insertMany, service } = setup();
        const provenance = resolveStatementProvenance({
            kind: 'public_web',
            citation: 'https://example.com/r',
            wording: { version: 'statementPublicWeb.v1', locale: 'en' },
        });

        if (provenance === undefined) {
            throw new Error('test setup: the statement must resolve');
        }

        await service.create(
            PRINCIPAL,
            { ...DTO, publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS },
            undefined,
            { provenance, lineOrigins: [{ kind: 'set', boundBy: 'exact', importLineId: null }] },
        );

        expect(insertMany).not.toHaveBeenCalled();
    });
});

describe('RecipesService.update — the attestation record', () => {
    it('records `statement: null` as a cleared row with no wording when a statement was stored', async () => {
        const stored: RecipeAggregate = {
            recipe: makeRecipeRow({
                ownerId: OWNER,
                status: 'draft',
                visibility: 'private',
                currentVersion: 1,
                statementKind: 'authored',
            }),
            ingredients: [],
            steps: [],
        };
        const { insertMany, service } = setup(stored);

        await service.update(PRINCIPAL, stored.recipe.id, { expectedVersion: 1, statement: null }, undefined);

        expect(insertMany).toHaveBeenCalledWith(FAKE_TX, [
            expect.objectContaining({
                mode: 'explicit',
                choice: 'cleared',
                action: 'update',
                wordingVersion: null,
                locale: null,
            }),
        ]);
    });

    it('records nothing for a clear when no statement was stored, because nothing changed', async () => {
        const stored: RecipeAggregate = {
            recipe: makeRecipeRow({ ownerId: OWNER, status: 'draft', visibility: 'private', currentVersion: 1 }),
            ingredients: [],
            steps: [],
        };
        const { insertMany, service } = setup(stored);

        await service.update(PRINCIPAL, stored.recipe.id, { expectedVersion: 1, statement: null }, undefined);

        expect(insertMany).not.toHaveBeenCalled();
    });
});
