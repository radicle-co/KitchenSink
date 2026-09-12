/**
 * Unit tests for `nutritionTargetOf` — the catalog-only gate on the URL-cached nutrition batch (curated plan U8 S6,
 * ADR-0020). The edge caches the batch on its URL alone, so an entry this answers is served to every caller: a
 * mid-erasure, retired or authored entry must answer nothing, exactly as an unknown id does.
 *
 * Each `undefined` row is built so that ONE clause of the gate is all that stands between it and a target. A retired
 * root reaches the gate's own clauses through a forward that ends at a root the seed retired.
 *
 * Curated U9 P0 (R29; owner, 2026-10-01: "Food doesn't just disappear"): a catalog root or variant the seed retired
 * with no successor answers its OWN numbers, whether it is requested directly or a forward ends at it. An authored or
 * mid-erasure root still answers nothing.
 */
import { describe, expect, it } from 'vitest';

import { AUTHOR_ID, makeFoodRefFacts } from '../../__fixtures__/foodRefFacts.js';
import type { FoodRefFacts } from '../../dao/food.dao.js';
import type { ForwardOutcome } from '../../dao/foodForward.dao.js';
import type { VariantFacts } from '../../dao/foodVariant.dao.js';
import type { RefFacts } from '../foodRefResolution.js';
import { nutritionTargetOf, type NutritionTarget } from '../nutritionTargets.js';

const ROOT_ID = '01J9ROOTAAAAAAAAAAAAAAAAAA';
const OTHER_ROOT_ID = '01J9ROOTBBBBBBBBBBBBBBBBBB';
const VARIANT_ID = '01J9VARAAAAAAAAAAAAAAAAAAA';
const OTHER_VARIANT_ID = '01J9VARBBBBBBBBBBBBBBBBBBB';
const UNKNOWN_ID = '01J9UNKNOWNNNNNNNNNNNNNNNN';

/** A variant of {@link ROOT_ID}, live unless a case says otherwise. Pure. */
function variantOf(overrides: Partial<VariantFacts> = {}): VariantFacts {
    return { id: VARIANT_ID, rootId: ROOT_ID, retired: false, parts: [], ...overrides };
}

/** A forward followed to `id`, an entry of `kind`. Pure. */
function forwardTo(kind: 'root' | 'variant', id: string): ForwardOutcome {
    return { resolved: true, id, kind, hops: 1 };
}

/** What the forward reader answers for a retired id that nothing forwards. Pure. */
function noForward(id: string): ForwardOutcome {
    return { resolved: true, id, kind: undefined, hops: 0 };
}

/** The reader's facts over these rows. Pure. */
function factsOf(
    roots: readonly FoodRefFacts[],
    variants: readonly VariantFacts[] = [],
    forwards: ReadonlyArray<readonly [string, ForwardOutcome]> = [],
): RefFacts {
    return {
        roots: new Map(roots.map((root) => [root.id, root])),
        variants: new Map(variants.map((variant) => [variant.id, variant])),
        forwards: new Map(forwards),
    };
}

const liveRoot = makeFoodRefFacts({ id: ROOT_ID });

describe('nutritionTargetOf — answers nothing for an entry the cached batch must never serve', () => {
    it.each<[string, string, RefFacts]>([
        ['an unknown id', UNKNOWN_ID, factsOf([liveRoot], [variantOf()])],
        ['a root mid-erasure (DELETING)', ROOT_ID, factsOf([makeFoodRefFacts({ id: ROOT_ID, status: 'DELETING' })])],
        [
            'a live variant whose root is mid-erasure (DELETING)',
            VARIANT_ID,
            factsOf([makeFoodRefFacts({ id: ROOT_ID, status: 'DELETING' })], [variantOf()]),
        ],
        [
            'a retired variant with no forward whose root is mid-erasure (DELETING)',
            VARIANT_ID,
            factsOf(
                [makeFoodRefFacts({ id: ROOT_ID, status: 'DELETING' })],
                [variantOf({ retired: true })],
                [[VARIANT_ID, noForward(VARIANT_ID)]],
            ),
        ],
        [
            'a retired variant with no forward whose root is authored',
            VARIANT_ID,
            factsOf(
                [makeFoodRefFacts({ id: ROOT_ID, userId: AUTHOR_ID, visibility: 'private' })],
                [variantOf({ retired: true })],
                [[VARIANT_ID, noForward(VARIANT_ID)]],
            ),
        ],
        [
            'a retired variant whose forward chain is a cycle',
            VARIANT_ID,
            factsOf([liveRoot], [variantOf({ retired: true })], [[VARIANT_ID, { resolved: false, reason: 'cycle' }]]),
        ],
        [
            'a retired variant whose forward ends at a variant the reader did not find',
            VARIANT_ID,
            factsOf([liveRoot], [variantOf({ retired: true })], [[VARIANT_ID, forwardTo('variant', OTHER_VARIANT_ID)]]),
        ],
        [
            'a live variant whose root is authored',
            VARIANT_ID,
            factsOf([makeFoodRefFacts({ id: ROOT_ID, userId: AUTHOR_ID, visibility: 'private' })], [variantOf()]),
        ],
        [
            'a live variant whose root is authored and promoted',
            VARIANT_ID,
            factsOf([makeFoodRefFacts({ id: ROOT_ID, userId: AUTHOR_ID, visibility: 'promoted' })], [variantOf()]),
        ],
        [
            'an authored root requested directly',
            ROOT_ID,
            factsOf([makeFoodRefFacts({ id: ROOT_ID, userId: AUTHOR_ID, visibility: 'private' })]),
        ],
        ['a live variant whose root the reader did not find', VARIANT_ID, factsOf([], [variantOf()])],
        [
            'a retired root whose forward ends at an authored root',
            ROOT_ID,
            factsOf(
                [
                    makeFoodRefFacts({ id: ROOT_ID, retired: true }),
                    makeFoodRefFacts({ id: OTHER_ROOT_ID, userId: AUTHOR_ID, visibility: 'private' }),
                ],
                [],
                [[ROOT_ID, forwardTo('root', OTHER_ROOT_ID)]],
            ),
        ],
        [
            'a retired root whose forward the reader did not follow',
            ROOT_ID,
            factsOf([makeFoodRefFacts({ id: ROOT_ID, retired: true })]),
        ],
        [
            'an authored root retired with no successor',
            ROOT_ID,
            factsOf(
                [makeFoodRefFacts({ id: ROOT_ID, retired: true, userId: AUTHOR_ID, visibility: 'private' })],
                [],
                [[ROOT_ID, noForward(ROOT_ID)]],
            ),
        ],
        [
            'a catalog root retired with no successor, mid-erasure (DELETING)',
            ROOT_ID,
            factsOf(
                [makeFoodRefFacts({ id: ROOT_ID, retired: true, status: 'DELETING' })],
                [],
                [[ROOT_ID, noForward(ROOT_ID)]],
            ),
        ],
    ])('%s', (_, id, facts) => {
        expect(nutritionTargetOf(id, facts)).toBeUndefined();
    });
});

describe('nutritionTargetOf — answers a live catalog entry with the entry whose numbers serve it', () => {
    it.each<[string, string, RefFacts, NutritionTarget]>([
        ['a live root', ROOT_ID, factsOf([liveRoot]), { kind: 'root', rootId: ROOT_ID, status: 'RESOLVED' }],
        [
            'a live variant',
            VARIANT_ID,
            factsOf([liveRoot], [variantOf()]),
            { kind: 'variant', variantId: VARIANT_ID, rootId: ROOT_ID, status: 'RESOLVED' },
        ],
        [
            'a retired root, as the live root its forward ends at',
            ROOT_ID,
            factsOf(
                [makeFoodRefFacts({ id: ROOT_ID, retired: true }), makeFoodRefFacts({ id: OTHER_ROOT_ID })],
                [],
                [[ROOT_ID, forwardTo('root', OTHER_ROOT_ID)]],
            ),
            { kind: 'root', rootId: OTHER_ROOT_ID, status: 'RESOLVED' },
        ],
        [
            'a retired variant, as the live variant its forward ends at',
            VARIANT_ID,
            factsOf(
                [liveRoot],
                [variantOf({ retired: true }), variantOf({ id: OTHER_VARIANT_ID })],
                [[VARIANT_ID, forwardTo('variant', OTHER_VARIANT_ID)]],
            ),
            { kind: 'variant', variantId: OTHER_VARIANT_ID, rootId: ROOT_ID, status: 'RESOLVED' },
        ],
        [
            '⛔ R29: a variant the seed retired with no successor, as ITSELF, while its root is live',
            VARIANT_ID,
            factsOf([liveRoot], [variantOf({ retired: true })], [[VARIANT_ID, noForward(VARIANT_ID)]]),
            { kind: 'variant', variantId: VARIANT_ID, rootId: ROOT_ID, status: 'RESOLVED' },
        ],
        [
            // Rewritten for U9 P0: this row was `undefined`, which took the numbers of a line whose variant was first
            // merged into another and then removed. The chain's end answers for itself, as a directly-requested one does.
            '⛔ R29: a retired variant whose forward ends at a variant the seed retired, as that variant',
            VARIANT_ID,
            factsOf(
                [liveRoot],
                [variantOf({ retired: true }), variantOf({ id: OTHER_VARIANT_ID, retired: true })],
                [[VARIANT_ID, forwardTo('variant', OTHER_VARIANT_ID)]],
            ),
            { kind: 'variant', variantId: OTHER_VARIANT_ID, rootId: ROOT_ID, status: 'RESOLVED' },
        ],
        [
            // Owner, 2026-10-01: these four were `undefined` until roots joined R29.
            '⛔ a catalog root the seed retired with no successor, as ITSELF',
            ROOT_ID,
            factsOf([makeFoodRefFacts({ id: ROOT_ID, retired: true })], [], [[ROOT_ID, noForward(ROOT_ID)]]),
            { kind: 'root', rootId: ROOT_ID, status: 'RESOLVED' },
        ],
        [
            '⛔ a retired root whose forward ends at a root the seed retired, as that root',
            ROOT_ID,
            factsOf(
                [
                    makeFoodRefFacts({ id: ROOT_ID, retired: true }),
                    makeFoodRefFacts({ id: OTHER_ROOT_ID, retired: true }),
                ],
                [],
                [[ROOT_ID, forwardTo('root', OTHER_ROOT_ID)]],
            ),
            { kind: 'root', rootId: OTHER_ROOT_ID, status: 'RESOLVED' },
        ],
        [
            '⛔ a live variant whose catalog root the seed retired, under that root',
            VARIANT_ID,
            factsOf([makeFoodRefFacts({ id: ROOT_ID, retired: true })], [variantOf()]),
            { kind: 'variant', variantId: VARIANT_ID, rootId: ROOT_ID, status: 'RESOLVED' },
        ],
        [
            '⛔ a retired variant whose catalog root the seed also retired, under that root',
            VARIANT_ID,
            factsOf(
                [makeFoodRefFacts({ id: ROOT_ID, retired: true })],
                [variantOf({ retired: true })],
                [[VARIANT_ID, noForward(VARIANT_ID)]],
            ),
            { kind: 'variant', variantId: VARIANT_ID, rootId: ROOT_ID, status: 'RESOLVED' },
        ],
    ])('%s', (_, id, facts, target) => {
        expect(nutritionTargetOf(id, facts)).toStrictEqual(target);
    });
});
