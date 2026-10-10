/**
 * Which remote hits a cook sees, and which are search gaps (ADR-0055 point 4, R66, review finding 7). A hit for a food
 * the catalog holds is hidden; when that food is not in this answer's catalog results, the hit names wording our
 * catalog lacks and is recorded. A hit for an item the catalog retired with no forward is hidden and records nothing.
 * A hit whose root name a live catalog root holding a record already carries is hidden and recorded the same way, since
 * a pick of it answers that root; a placeholder carrying the name leaves it shown, since a pick completes it.
 */
import { describe, expect, it } from 'vitest';

import type { CatalogOwner, KeyStanding } from '../../catalogOwnerReader.service.js';
import type { FoodStatus } from '../../dao/food.dao.js';
import type { NamedRoot } from '../../dao/remoteAdoption.dao.js';
import { triageRemoteHits, type RemoteHitTriageInput } from '../remoteHitTriage.js';

const ROOT: CatalogOwner = {
    kind: 'root',
    id: 'R-kale',
    rootId: 'R-kale',
    rootName: 'kale',
    seedOwned: true,
    parts: [],
};
const VARIANT: CatalogOwner = {
    kind: 'variant',
    id: 'V-kale-cooked',
    rootId: 'R-kale',
    rootName: 'kale',
    seedOwned: true,
    parts: [{ attribute: 'cookingMethod', ordinal: 0, text: 'boiled' }],
};

const HELD = { externalKey: '1', name: 'Kale, raw', lineageKey: 'foundation:11233' };
const VARIANT_HELD = { externalKey: '2', name: 'Kale, cooked, boiled', lineageKey: null };
const NEW = { externalKey: '3', name: 'Kale chips, baked', lineageKey: null };
const RETIRED = { externalKey: '4', name: 'Kale, frozen', lineageKey: null };
/** A hit no key holds, whose root name a live catalog root carries. */
const NAMED = { externalKey: '6', name: 'Kale chips, plain', lineageKey: null };

/**
 * The live catalog roots by name key, with the root carrying {@link NAMED}'s name in `status`.
 *
 * @param status - That root's status.
 * @returns The roots.
 */
function namedRootsOf(status: FoodStatus): ReadonlyMap<string, NamedRoot> {
    return new Map([['kale chips, plain', { id: 'R-chips', status }]]);
}

/**
 * A triage input over the four fixture hits.
 *
 * @param overrides - What a case changes.
 * @returns The input.
 */
function inputOf(overrides: Partial<RemoteHitTriageInput> = {}): RemoteHitTriageInput {
    const standing: KeyStanding = {
        owners: new Map([
            ['1', ROOT],
            ['2', VARIANT],
        ]),
        retired: new Set(['4']),
    };

    return {
        query: 'kale',
        source: 'usda',
        items: [HELD, VARIANT_HELD, NEW, RETIRED],
        standing,
        namedRoots: new Map(),
        catalogRootIds: new Set(),
        ...overrides,
    };
}

describe('triageRemoteHits', () => {
    it('shows only the hit the catalog does not hold (the positive control)', () => {
        expect(triageRemoteHits(inputOf()).shown).toStrictEqual([NEW]);
    });

    it('records a held hit whose food this answer’s catalog results lack, naming the root', () => {
        expect(triageRemoteHits(inputOf({ items: [HELD] })).gaps).toStrictEqual([
            {
                query: 'kale',
                source: 'usda',
                externalKey: '1',
                foodId: 'R-kale',
                foodVariantId: null,
                remoteName: 'Kale, raw',
            },
        ]);
    });

    it('records a variant-held hit under its root, naming the variant', () => {
        expect(triageRemoteHits(inputOf({ items: [VARIANT_HELD] })).gaps).toStrictEqual([
            {
                query: 'kale',
                source: 'usda',
                externalKey: '2',
                foodId: 'R-kale',
                foodVariantId: 'V-kale-cooked',
                remoteName: 'Kale, cooked, boiled',
            },
        ]);
    });

    it('⛔ records no gap for a held hit whose root the catalog results already show: a duplicate, not a gap', () => {
        const triage = triageRemoteHits(inputOf({ catalogRootIds: new Set(['R-kale']) }));

        expect(triage.gaps).toStrictEqual([]);
        expect(triage.shown).toStrictEqual([NEW]);
    });

    it('records no gap when the catalog read failed, because presence is then unknown', () => {
        const triage = triageRemoteHits(inputOf({ catalogRootIds: undefined }));

        expect(triage.gaps).toStrictEqual([]);
        expect(triage.shown).toStrictEqual([NEW]);
    });

    it('hides a retired item and records nothing for it', () => {
        const triage = triageRemoteHits(inputOf({ items: [RETIRED] }));

        expect(triage).toStrictEqual({ shown: [], gaps: [] });
    });

    it('keeps the source’s order, and one of each key, in what it shows and what it records', () => {
        const other = { externalKey: '5', name: 'Kale pesto', lineageKey: null };
        const triage = triageRemoteHits(inputOf({ items: [other, HELD, NEW, HELD, other] }));

        expect(triage.shown).toStrictEqual([other, NEW]);
        expect(triage.gaps.map((gap) => gap.externalKey)).toStrictEqual(['1']);
    });

    // A pick makes a root under the hit's root name, so two shown hits sharing one would answer one root.
    it('shows one hit per root name, the first in the source’s order', () => {
        const respelled = { externalKey: '7', name: '  KALE CHIPS,​ baked ', lineageKey: null };
        const other = { externalKey: '5', name: 'Kale pesto', lineageKey: null };
        const triage = triageRemoteHits(inputOf({ items: [NEW, other, respelled] }));

        expect(triage.shown).toStrictEqual([NEW, other]);
    });
});

describe('triageRemoteHits — a hit whose root name a live catalog root carries (R66; ADR-0055 points 4 and 10)', () => {
    it.each<[FoodStatus, 'hidden' | 'shown']>([
        ['RESOLVED', 'hidden'],
        ['PENDING', 'shown'],
        ['AWAITING_RETRY', 'shown'],
        ['UNRESOLVED', 'shown'],
        ['NOT_FOUND', 'shown'],
        ['FAILED', 'shown'],
    ])('a root in %s leaves the hit %s', (status, outcome) => {
        const triage = triageRemoteHits(inputOf({ items: [NAMED], namedRoots: namedRootsOf(status) }));

        expect(triage.shown).toStrictEqual(outcome === 'hidden' ? [] : [NAMED]);
    });

    it('still shows a hit whose name no root carries, beside one a root holding a record carries (the control)', () => {
        const triage = triageRemoteHits(inputOf({ items: [NAMED, NEW], namedRoots: namedRootsOf('RESOLVED') }));

        expect(triage.shown).toStrictEqual([NEW]);
    });

    it('matches the name by the catalog’s key, not its spelling', () => {
        const shouted = { ...NAMED, name: '  KALE CHIPS,\u200B plain ' };

        expect(
            triageRemoteHits(inputOf({ items: [shouted], namedRoots: namedRootsOf('RESOLVED') })).shown,
        ).toStrictEqual([]);
    });

    it('records the hidden hit under the named root when this answer’s catalog results lack that root', () => {
        expect(triageRemoteHits(inputOf({ items: [NAMED], namedRoots: namedRootsOf('RESOLVED') })).gaps).toStrictEqual([
            {
                query: 'kale',
                source: 'usda',
                externalKey: '6',
                foodId: 'R-chips',
                foodVariantId: null,
                remoteName: 'Kale chips, plain',
            },
        ]);
    });

    it.each<[string, ReadonlySet<string> | undefined]>([
        ['the catalog results already show the root', new Set(['R-chips'])],
        ['the catalog read failed', undefined],
    ])('records no gap for it when %s', (_label, catalogRootIds) => {
        const triage = triageRemoteHits(
            inputOf({ items: [NAMED], namedRoots: namedRootsOf('RESOLVED'), catalogRootIds }),
        );

        expect(triage).toStrictEqual({ shown: [], gaps: [] });
    });

    it('records no gap for a hit a placeholder carries, which stays shown', () => {
        expect(triageRemoteHits(inputOf({ items: [NAMED], namedRoots: namedRootsOf('PENDING') })).gaps).toStrictEqual(
            [],
        );
    });
});
