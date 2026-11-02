/**
 * `IngredientsService.addByNameThroughCascade` (the version restorer's door; the editor's by-name no longer consults the tiers) records WHICH TIER bound a line, and nothing else (ADR-0071).
 *
 * ⚠️ REWRITTEN for ADR-0071. This file used to prove that a RANKED resolution persisted its full band-keyed event
 * (rung, margin, shortlist, query shape, ranker version, observed band epoch) and read band authority for the epoch.
 * By-name now runs the settled chain `[curated, memo]` only, so no production resolution on this path is ranked, and
 * the ranked branch, its band-authority read and the `bands` constructor parameter were deleted as unreachable. The
 * lexical tier's rung-less coverage moved to the proposal path: `matchProposal.service.test.ts` (unit) and
 * `lexicalRungTolerance.integration.test.ts` (integration), both through `MatchProposalService`.
 *
 * What stays: the event is telemetry, keyed by the `food_lookups` row the resolution bound, and it carries the tier.
 */
import { describe, expect, it, vi } from 'vitest';

import type { RootArm } from '../../database/schema/foodLookupArm.js';
import type { FoodLookupsDal } from '../dal/foodLookups.dal.js';
import type { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import type { FoodRefsGateway } from '../foodRefs.gateway.js';
import { IngredientsService } from '../ingredients.service.js';
import type { ResolutionTier } from '../resolution/resolutionCascade.js';
import { CALLER_TOKEN as CALLER, makeCanonicalName, makeFoodClients } from '../__fixtures__/ingredients.fixtures.js';

const MAPPED_FOOD = '01JU10WIRE0000000000MAPPED';
const AUTHOR = '01JU10WIRE0000000000AUTHOR';
const NAME = makeCanonicalName('plain flour');
const BOUND: RootArm = {
    kind: 'root',
    lookupId: 'lookup-mapped',
    foodId: MAPPED_FOOD,
    foodOwnerId: null,
    createdAt: new Date('2026-09-30T00:00:00.000Z'),
};

const curatedTier: ResolutionTier = {
    id: 'curated',
    resolve: async () => ({
        kind: 'resolved',
        tier: 'curated',
        food: { kind: 'root', id: MAPPED_FOOD },
        evidence: 'curated mapping',
    }),
};

/**
 * A tier answering with a RANKED shape. No production by-name chain holds one (ADR-0071); it is here to prove the
 * event write no longer carries a ranked shape whatever a tier hands it.
 */
const rankedShapedTier: ResolutionTier = {
    id: 'memo',
    resolve: async () => ({
        kind: 'resolved',
        tier: 'memo',
        food: { kind: 'root', id: MAPPED_FOOD },
        evidence: 'memo',
        confidence: 0.29,
        shortlist: [{ foodId: MAPPED_FOOD, score: 0.91 }],
        rung: 'head',
    }),
};

function build(record: ReturnType<typeof vi.fn>, tier: ResolutionTier): IngredientsService {
    const lookups = { findOrCreateBound: vi.fn().mockResolvedValue(BOUND) } as unknown as FoodLookupsDal;
    const refs = {
        resolveForBind: vi.fn().mockResolvedValue({
            outcome: 'found',
            name: makeCanonicalName('Plain flour'),
            status: 'RESOLVED',
            isPrivate: false,
            rootId: MAPPED_FOOD,
        }),
    } as unknown as FoodRefsGateway;

    return new IngredientsService(
        lookups,
        makeFoodClients().clients,
        { search: vi.fn() } as unknown as FoodCatalogGateway,
        refs,
        [tier],
        { record } as never,
    );
}

describe('addByName — the resolution event names the tier, on the binding (ADR-0071)', () => {
    it('records the binding and the tier that bound it, and nothing more', async () => {
        const record = vi.fn().mockResolvedValue(undefined);

        await build(record, curatedTier).addByNameThroughCascade(CALLER, NAME, AUTHOR);

        expect(record).toHaveBeenCalledWith({ foodLookupId: 'lookup-mapped', tier: 'curated' });
    });

    it('⛔ writes no ranked shape and no band epoch, whatever the tier handed over', async () => {
        const record = vi.fn().mockResolvedValue(undefined);

        await build(record, rankedShapedTier).addByNameThroughCascade(CALLER, NAME, AUTHOR);

        expect(record).toHaveBeenCalledWith({ foodLookupId: 'lookup-mapped', tier: 'memo' });
    });

    it('⚠️ a lost event never fails a resolution that succeeded', async () => {
        const record = vi.fn().mockRejectedValue(new Error('insert refused'));

        const admitted = await build(record, curatedTier).addByNameThroughCascade(CALLER, NAME, AUTHOR);

        expect(admitted.foodId).toBe(MAPPED_FOOD);
    });
});
