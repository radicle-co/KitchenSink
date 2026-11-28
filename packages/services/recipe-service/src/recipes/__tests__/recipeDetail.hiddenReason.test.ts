/**
 * The detail response's owner-only `hiddenReason` (hiddenViews U2, AE1-AE4). The assembler reads the database's own answer
 * (`findOwnerHiddenFacts`) for the OWNER and nobody else, so every detail response, mutation responses included, carries it.
 * Every non-owner row here is HELD, so a deleted owner gate fails the test.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeRecipeRow } from '../../__fixtures__/index.js';
import { CallerToken } from '../../auth/CallerToken.js';
import { makeRecipeDetailAssembler } from '../__fixtures__/recipeDetailAssembler.fixture.js';
import { fakeRecipesDal } from '../__fixtures__/recipesDal.fixture.js';
import type { RecipeAggregate } from '../dal/recipes.dal.js';

const OWNER = '01JHIDDENDETAILOWNER00001';
const READER = '01JHIDDENDETAILREADER0001';
const CALLER = CallerToken.fromAuthorizationHeader('Bearer hidden-detail');

const read = (
    recipe: ReturnType<typeof makeRecipeRow>,
    viewerId: string,
    facts = { ownerHeldFromReaders: true, hasCookSourceEvidence: false },
) => {
    const findOwnerHiddenFacts = vi.fn(async () => facts);
    const assembler = makeRecipeDetailAssembler({ dal: fakeRecipesDal({ findOwnerHiddenFacts }) });
    const aggregate: RecipeAggregate = { recipe, steps: [], ingredients: [] };

    return assembler
        .toDetailResponse(aggregate, [], { caller: CALLER, budget: 'read', viewerId })
        .then((detail) => ({ detail, findOwnerHiddenFacts }));
};

describe('RecipeDetailAssembler.toDetailResponse: hiddenReason', () => {
    it('tells the owner of a held public recipe the correction hold is why (AE1)', async () => {
        const { detail } = await read(
            makeRecipeRow({ ownerId: OWNER, visibility: 'public', sourceCorrectionHold: true }),
            OWNER,
        );

        expect(detail.hiddenReason).toBe('sourceCorrected');
    });

    it('tells the owner a recorded source is why, from the selected evidence term (AE2)', async () => {
        const { detail } = await read(makeRecipeRow({ ownerId: OWNER, visibility: 'public' }), OWNER, {
            ownerHeldFromReaders: true,
            hasCookSourceEvidence: true,
        });

        expect(detail.hiddenReason).toBe('heldSource');
    });

    it('gives `other`, the chip with no line, when the read rule holds a recipe for a term the function does not map (held, no hold, no evidence, no label)', async () => {
        const { detail } = await read(
            makeRecipeRow({
                ownerId: OWNER,
                visibility: 'public',
                sourceCorrectionHold: false,
                statementKind: 'fromPerson',
            }),
            OWNER,
        );

        expect(detail.hiddenReason).toBe('other');
    });

    it('carries nothing for a recipe the read rule does not hold, a private one, or a stranger', async () => {
        const held = makeRecipeRow({ ownerId: OWNER, visibility: 'public', sourceCorrectionHold: true });
        const clean = await read(held, OWNER, { ownerHeldFromReaders: false, hasCookSourceEvidence: false });
        const priv = await read({ ...held, visibility: 'private' }, OWNER);
        const stranger = await read(held, READER);

        expect(clean.detail).not.toHaveProperty('hiddenReason');
        expect(priv.detail).not.toHaveProperty('hiddenReason');
        expect(stranger.detail).not.toHaveProperty('hiddenReason');
        // A reader pays no extra read.
        expect(stranger.findOwnerHiddenFacts).not.toHaveBeenCalled();
    });
});
