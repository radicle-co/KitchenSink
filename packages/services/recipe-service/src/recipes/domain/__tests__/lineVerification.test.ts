/**
 * ⛔ THE READ SIDE of the U11 verification gate — the pure rules that turn a stored verdict into something a
 * cook can see, and that decide which verdict a given recipe line is even ABOUT.
 *
 * Three properties here are the ones a mocked service test cannot reach, and each has a wrong-by-default
 * reading:
 *
 *  1. **The identity must be byte-identical to the one the WORKER hashed.** The verdict's primary key is a
 *     digest over `[version, normalizedLine, foodId, quantityLow, quantityHigh, unit]`; a reader that spells
 *     any element differently computes a key that matches nothing and reports "no verdict" forever — which
 *     looks exactly like a healthy system, because absence of a verdict means PUBLISH.
 *  2. **`unit: ''` and `unit: null` are DIFFERENT preimages.** `recipe_ingredients.unit` is `NOT NULL` and
 *     spells "unitless" as the empty string; the queue message spells it `null`. One of the two has to
 *     convert, and if the producer and the reader disagree about which, every unitless line silently misses.
 *  3. **Only `contradicted` withholds.** `verified` and `inconclusive` behave exactly as the system did
 *     before the gate existed — migration 0023 is explicit that the only coherent read-side rule for an
 *     asynchronous gate is "an explicit contradiction withholds, everything else publishes".
 */
import { describe, expect, it } from 'vitest';
import { ABSENT_QUANTITY, FoodResolutionStatus } from '@kitchensink/recipe-core';
import { verificationKeyPreimage } from '@kitchensink/recipe-core/resolution/verification-key';

import { resolveLineStatus, verifiedLineIdentity, VERIFICATION_BANDS } from '../lineVerification.js';

describe('verifiedLineIdentity — what a verdict about this line would be keyed on', () => {
    it('carries an exact quantity as the LOW bound with no high bound', () => {
        expect(
            verifiedLineIdentity(
                { sourceLine: '2 cups flour', quantity: { kind: 'exact', value: 2 }, unit: 'cup' },
                'food_1',
            ),
        ).toStrictEqual({
            sourceLine: '2 cups flour',
            foodId: 'food_1',
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
        });
    });

    it('carries BOTH bounds of a stated range', () => {
        const identity = verifiedLineIdentity(
            { sourceLine: '2 to 3 cups flour', quantity: { kind: 'range', low: 2, high: 3 }, unit: 'cup' },
            'food_1',
        );

        expect(identity).toMatchObject({ quantityLow: 2, quantityHigh: 3 });
    });

    it('carries an ABSENT quantity as two nulls — never a fabricated 0 or 1', () => {
        const identity = verifiedLineIdentity(
            { sourceLine: 'butter the size of an egg', quantity: ABSENT_QUANTITY, unit: '' },
            'food_1',
        );

        expect(identity).toMatchObject({ quantityLow: null, quantityHigh: null });
    });

    it('⛔ converts the unitless EMPTY STRING to null — the spelling the worker hashed', () => {
        const identity = verifiedLineIdentity(
            { sourceLine: '2 eggs', quantity: { kind: 'exact', value: 2 }, unit: '' },
            'food_1',
        );

        expect(identity?.unit).toBeNull();
        // Stated as a preimage assertion too, because the DIGEST — not the object — is what has to agree with
        // the worker. `'null]'` is the tail of the canonical JSON array, so this fails if `''` ever survives.
        expect(identity === undefined ? '' : verificationKeyPreimage(identity)).toContain('null]');
    });

    it('⛔ a unitless line and a line measured in `each` are DIFFERENT judgements', () => {
        const unitless = verifiedLineIdentity(
            { sourceLine: '2 eggs', quantity: { kind: 'exact', value: 2 }, unit: '' },
            'food_1',
        );
        const withUnit = verifiedLineIdentity(
            { sourceLine: '2 eggs', quantity: { kind: 'exact', value: 2 }, unit: 'each' },
            'food_1',
        );

        expect(unitless).toBeDefined();
        expect(withUnit).toBeDefined();
        expect(unitless === undefined ? 'a' : verificationKeyPreimage(unitless)).not.toEqual(
            withUnit === undefined ? 'b' : verificationKeyPreimage(withUnit),
        );
    });

    it('returns undefined when the line was AUTHORED rather than transcribed (no source line)', () => {
        expect(
            verifiedLineIdentity({ sourceLine: null, quantity: { kind: 'exact', value: 2 }, unit: 'cup' }, 'food_1'),
        ).toBeUndefined();
    });

    it('returns undefined when a source line is present but blank — there is nothing to judge', () => {
        expect(
            verifiedLineIdentity({ sourceLine: '   ', quantity: { kind: 'exact', value: 2 }, unit: 'cup' }, 'food_1'),
        ).toBeUndefined();
    });

    it('returns undefined for a freeform line that maps to no food', () => {
        expect(
            verifiedLineIdentity(
                { sourceLine: '2 cups flour', quantity: { kind: 'exact', value: 2 }, unit: 'cup' },
                undefined,
            ),
        ).toBeUndefined();
    });
});

describe('resolveLineStatus — which status one recipe line reports', () => {
    it('reports NEEDS_REVIEW when the gate CONTRADICTED the line, overriding the catalog mirror', () => {
        expect(resolveLineStatus('contradicted', FoodResolutionStatus.RESOLVED)).toBe(
            FoodResolutionStatus.NEEDS_REVIEW,
        );
    });

    it('reports NEEDS_REVIEW even when the catalog knows nothing about the food', () => {
        expect(resolveLineStatus('contradicted', undefined)).toBe(FoodResolutionStatus.NEEDS_REVIEW);
    });

    it('⛔ passes a VERIFIED line through unchanged — a verdict that agreed changes nothing', () => {
        expect(resolveLineStatus('verified', FoodResolutionStatus.RESOLVED)).toBe(FoodResolutionStatus.RESOLVED);
    });

    it('⛔ passes an INCONCLUSIVE line through unchanged — abstention is not disagreement', () => {
        expect(resolveLineStatus('inconclusive', FoodResolutionStatus.PENDING)).toBe(FoodResolutionStatus.PENDING);
    });

    it('⛔ ABSENCE OF A VERDICT MEANS PUBLISH — the line reports its catalog status alone (0023)', () => {
        expect(resolveLineStatus(undefined, FoodResolutionStatus.PENDING)).toBe(FoodResolutionStatus.PENDING);
    });

    it('reports nothing at all for an unjudged line with no catalog status', () => {
        expect(resolveLineStatus(undefined, undefined)).toBeUndefined();
    });

    it('is TOTAL over every band migration 0023 admits', () => {
        for (const band of VERIFICATION_BANDS) {
            expect(resolveLineStatus(band, FoodResolutionStatus.RESOLVED)).toBeDefined();
        }
    });
});
