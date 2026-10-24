/**
 * What a by-name food's fan-out may offer, and what it resolves to, when the catalog already holds some of the
 * source's answer (FOOD-SERVICE-6; ADR-0055 point 4: a remote hit for a food the catalog holds is hidden).
 *
 * - A hit the owner reader answers is held: hidden, never fetched, and its live entry is a holder.
 * - A hit whose item the catalog retired with no forward is hidden and names no holder.
 * - An unheld hit sharing a held hit's name is the same survivor as that hit (the merge engine's name grain), so it is
 *   hidden too: offering it would make a second food of the holder's.
 * - Holders count as survivors under the existing survivor-count rule: one survivor resolves (to the holder, by a
 *   forward, when it is one), several stay UNRESOLVED over what can be offered, and none is NOT_FOUND.
 * - A pick that names a held item resolves to its one holder; several holders, or a retired item, is refused.
 */
import { describe, expect, it } from 'vitest';

import type { CatalogOwner, KeyStanding } from '../../catalogOwnerReader.service.js';
import { makeMergeCandidate } from '../../merge/__fixtures__/merge.fixtures.js';
import type { MergeResult } from '../../merge/mergeEngine.js';
import type { SourceCandidate } from '../../../sources/foodSourceAdapter.js';
import { fanOutDecisionOf, holdersOfItems, partitionHeldHits, pickDecisionOf } from '../heldCandidatePolicy.js';

const SELF = 'F-self';

/** A root owner, as the owner reader answers one. */
function rootOwner(id: string): CatalogOwner {
    return { kind: 'root', id, rootId: id, rootName: id, seedOwned: true, parts: [] };
}

/** A variant owner under a root. */
function variantOwner(id: string, rootId: string): CatalogOwner {
    return { kind: 'variant', id, rootId, rootName: rootId, seedOwned: true, parts: [] };
}

/** A source's search hit. */
function hit(externalKey: string, name: string): SourceCandidate {
    return { source: 'usda', externalKey, name, lineageKey: null };
}

/** One source's standing, as the per-source map a pick is judged against. */
function bySource(owners: Record<string, CatalogOwner>, retired: readonly string[] = []) {
    return new Map([['usda' as const, standing(owners, retired)]]);
}

/** The catalog's standing for some keys. */
function standing(owners: Record<string, CatalogOwner>, retired: readonly string[] = []): KeyStanding {
    return { owners: new Map(Object.entries(owners)), retired: new Set(retired) };
}

describe('partitionHeldHits', () => {
    it('offers every hit when the catalog holds none, in the source order', () => {
        const hits = [hit('1', 'Broccoli, raw'), hit('2', 'Broccoli, frozen')];

        expect(partitionHeldHits(hits, standing({}), SELF)).toEqual({ offered: hits, holders: [] });
    });

    it('hides a held hit and names its live entry as the holder', () => {
        const result = partitionHeldHits(
            [hit('1', 'Broccoli, raw'), hit('2', 'Broccoli, frozen')],
            standing({ '1': rootOwner('R-broccoli') }),
            SELF,
        );

        expect(result).toEqual({
            offered: [hit('2', 'Broccoli, frozen')],
            holders: [{ kind: 'root', id: 'R-broccoli' }],
        });
    });

    it('names a variant holder as the variant, not its root', () => {
        expect(
            partitionHeldHits([hit('1', 'Broccoli, raw')], standing({ '1': variantOwner('V-raw', 'R-b') }), SELF),
        ).toEqual({ offered: [], holders: [{ kind: 'variant', id: 'V-raw' }] });
    });

    it('hides a hit whose item the catalog retired with no forward, naming no holder', () => {
        expect(partitionHeldHits([hit('1', 'Broccoli, raw')], standing({}, ['1']), SELF)).toEqual({
            offered: [],
            holders: [],
        });
    });

    it("⛔ hides an unheld hit that shares a held hit's name: the engine's name grain makes it the holder's survivor", () => {
        const result = partitionHeldHits(
            [hit('1', 'Broccoli, raw'), hit('9', 'BROCCOLI,  RAW'), hit('2', 'Broccoli, frozen')],
            standing({ '1': rootOwner('R-broccoli') }),
            SELF,
        );

        expect(result.offered).toEqual([hit('2', 'Broccoli, frozen')]);
    });

    it('names each holder once, however many of its items the source answered', () => {
        const result = partitionHeldHits(
            [hit('1', 'Broccoli, raw'), hit('2', 'Broccoli, raw, Foundation')],
            standing({ '1': rootOwner('R-broccoli'), '2': rootOwner('R-broccoli') }),
            SELF,
        );

        expect(result.holders).toEqual([{ kind: 'root', id: 'R-broccoli' }]);
    });

    it('does not count the food itself as a holder of a key it owns', () => {
        const hits = [hit('1', 'Broccoli, raw')];

        expect(partitionHeldHits(hits, standing({ '1': rootOwner(SELF) }), SELF)).toEqual({
            offered: hits,
            holders: [],
        });
    });

    it('offers a repeated key once', () => {
        expect(partitionHeldHits([hit('1', 'Kale'), hit('1', 'Kale')], standing({}), SELF).offered).toEqual([
            hit('1', 'Kale'),
        ]);
    });
});

describe('fanOutDecisionOf', () => {
    const raw = makeMergeCandidate('usda', { externalKey: '1', name: 'Broccoli, raw' });
    const frozen = makeMergeCandidate('usda', { externalKey: '2', name: 'Broccoli, frozen' });
    const resolved: MergeResult = { outcome: 'RESOLVED', goldenRecord: null, candidateSet: [] };
    const unresolved: MergeResult = { outcome: 'UNRESOLVED', goldenRecord: null, candidateSet: [raw, frozen] };
    const notFound: MergeResult = { outcome: 'NOT_FOUND', goldenRecord: null, candidateSet: [] };

    it('keeps the merge outcome when the catalog held nothing', () => {
        expect(fanOutDecisionOf([raw], resolved, [])).toEqual({ kind: 'merge' });
        expect(fanOutDecisionOf([raw, frozen], unresolved, [])).toEqual({ kind: 'merge' });
        expect(fanOutDecisionOf([], notFound, [])).toEqual({ kind: 'merge' });
    });

    it('forwards to the one holder when nothing else survived', () => {
        expect(fanOutDecisionOf([], notFound, [{ kind: 'root', id: 'R-b' }])).toEqual({
            kind: 'forward',
            to: { kind: 'root', id: 'R-b' },
        });
    });

    it('⛔ is NOT_FOUND when several holders survived and nothing can be offered: it never chooses between foods', () => {
        expect(
            fanOutDecisionOf([], notFound, [
                { kind: 'root', id: 'R-b' },
                { kind: 'variant', id: 'V-c' },
            ]),
        ).toEqual({ kind: 'notFound' });
    });

    it('⛔ stays UNRESOLVED over the one offerable candidate when a holder also survived: two survivors, no auto-pick', () => {
        expect(fanOutDecisionOf([frozen], resolved, [{ kind: 'root', id: 'R-b' }])).toEqual({
            kind: 'unresolved',
            candidateSet: [frozen],
        });
    });

    it('stays UNRESOLVED over the offerable set when the offerable candidates were already several', () => {
        expect(fanOutDecisionOf([raw, frozen], unresolved, [{ kind: 'root', id: 'R-b' }])).toEqual({
            kind: 'unresolved',
            candidateSet: [raw, frozen],
        });
    });
});

describe('pickDecisionOf', () => {
    const picks = [
        { source: 'usda' as const, externalKey: '1' },
        { source: 'usda' as const, externalKey: '2' },
    ];

    it('merges the picks when the catalog holds none of them', () => {
        expect(pickDecisionOf(picks, bySource({}), SELF)).toEqual({ kind: 'merge' });
    });

    it('resolves to the one holder a pick names', () => {
        expect(pickDecisionOf(picks, bySource({ '1': rootOwner('R-b') }), SELF)).toEqual({
            kind: 'forward',
            to: { kind: 'root', id: 'R-b' },
        });
    });

    it('resolves to the one holder when every pick names it', () => {
        expect(pickDecisionOf(picks, bySource({ '1': rootOwner('R-b'), '2': rootOwner('R-b') }), SELF)).toEqual({
            kind: 'forward',
            to: { kind: 'root', id: 'R-b' },
        });
    });

    it('⛔ refuses picks that name two holders', () => {
        expect(pickDecisionOf(picks, bySource({ '1': rootOwner('R-b'), '2': rootOwner('R-c') }), SELF)).toEqual({
            kind: 'refuse',
        });
    });

    it('⛔ refuses a pick of an item the catalog retired with no forward', () => {
        expect(pickDecisionOf(picks, bySource({}, ['2']), SELF)).toEqual({ kind: 'refuse' });
    });

    it('does not count the food itself as the holder of an item it already owns', () => {
        expect(pickDecisionOf(picks, bySource({ '1': rootOwner(SELF) }), SELF)).toEqual({ kind: 'merge' });
    });
});

describe('holdersOfItems', () => {
    it('⛔ reads each item against its OWN source’s standing: a key is unique within a source only', () => {
        const items = [{ source: 'usda' as const, externalKey: '1' }];

        expect(holdersOfItems(items, new Map(), SELF)).toEqual([]);
        expect(holdersOfItems(items, bySource({ '1': rootOwner('R-b') }), SELF)).toEqual([{ kind: 'root', id: 'R-b' }]);
    });
});
