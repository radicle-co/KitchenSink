/**
 * `IngredientsService.addByName` records a RANKED resolution's full band-keyed event (plan U4, KTD-C) on the
 * binding it produced.
 *
 * ⚠️ REWRITTEN for plan 002 (0051). The cascade-first, stale-mapping and exhausted-cascade cases this file used
 * to hold moved to `ingredients.service.test.ts` in the binding model's terms. What stays here is the event: a
 * ranked resolution persists its confidence shape so the band log and the verification producer have a
 * substrate, keyed by the `food_lookups` row the resolution bound.
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

const rankedTier: ResolutionTier = {
    id: 'lexical',
    resolve: async () => ({
        kind: 'resolved',
        tier: 'lexical',
        food: { kind: 'root', id: MAPPED_FOOD },
        evidence: 'lexical shortlist (rung head, 2 candidates, margin 0.290)',
        confidence: 0.29,
        shortlist: [
            { foodId: MAPPED_FOOD, score: 0.91 },
            { foodId: '01JU10WIRE000000000RUNNER0', score: 0.62 },
        ],
        rung: 'head',
    }),
};

function build(record: ReturnType<typeof vi.fn>, authorityFor: ReturnType<typeof vi.fn>): IngredientsService {
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
        [rankedTier],
        { record } as never,
        { authorityFor } as never,
    );
}

describe('addByName — a RANKED resolution records the full band-keyed event (plan U4, KTD-C)', () => {
    it('persists rung, margin, shortlist, query shape, ranker version and the observed band epoch, on the binding', async () => {
        const record = vi.fn().mockResolvedValue(undefined);
        const authorityFor = vi.fn().mockResolvedValue({ state: 'observing', epoch: 0 });

        await build(record, authorityFor).addByName(CALLER, NAME, AUTHOR);

        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                foodLookupId: 'lookup-mapped',
                tier: 'lexical',
                rung: 'head',
                margin: 0.29,
                queryShape: 'multi-word',
                rankerVersion: expect.any(String),
                bandEpoch: '0',
                shortlist: [
                    { foodId: MAPPED_FOOD, score: 0.91 },
                    { foodId: '01JU10WIRE000000000RUNNER0', score: 0.62 },
                ],
            }),
        );
        expect(authorityFor).toHaveBeenCalledWith(expect.objectContaining({ rung: 'head', queryShape: 'multi-word' }));
    });

    it('⚠️ an unreadable band authority degrades to an event with NO epoch — never a failed resolution', async () => {
        const record = vi.fn().mockResolvedValue(undefined);
        const authorityFor = vi.fn().mockRejectedValue(new Error('band table unreachable'));

        const admitted = await build(record, authorityFor).addByName(CALLER, NAME, AUTHOR);

        expect(admitted.foodId).toBe(MAPPED_FOOD);
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ bandEpoch: undefined }));
    });
});
