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

import {
    PENDING_VERIFICATION_MAX_AGE_HOURS,
    isWithheldLine,
    pendingStateOf,
    resolveLineStatus,
    verifiedLineIdentity,
    VERIFICATION_BANDS,
} from '../lineVerification.js';

describe('verifiedLineIdentity — what a verdict about this line would be keyed on', () => {
    it('carries an exact quantity as the LOW bound with no high bound', () => {
        expect(
            verifiedLineIdentity(
                {
                    sourceLine: '2 cups flour',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    statedMeasure: undefined,
                },
                'food_1',
            ),
        ).toStrictEqual({
            sourceLine: '2 cups flour',
            foodId: 'food_1',
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
            // U7/U11 — `null`, not absent: the member is REQUIRED on the identity so a construction site that
            // forgets it cannot silently key the old way. `null` says this line was not restated.
            statedMeasure: null,
        });
    });

    /**
     * U7/U11 — the pair the SOURCE printed, carried into the judgement's identity.
     *
     * ⛔ These are the assertions that make the `v2` key bump meaningful. Before migration 0027 a restated
     * line reached the gate as `[.., 0.5, null, 'cup']` and nothing recorded that the source had printed
     * `one gill`, so the model — shown the source line beside `0.5 cup` — correctly DISAGREED with a line we
     * had parsed right. Two things had to change together: the model must be asked about the gill, and the
     * verdict must be keyed on it, or the corrected line would look up the pre-correction verdict forever.
     */
    it('carries the stated measure the source printed, when the line was restated', () => {
        expect(
            verifiedLineIdentity(
                {
                    sourceLine: 'one gill of milk',
                    quantity: { kind: 'exact', value: 0.5 },
                    unit: 'cup',
                    statedMeasure: { quantity: { kind: 'exact', value: 1 }, unit: 'gill' },
                },
                'food_1',
            ),
        ).toStrictEqual({
            sourceLine: 'one gill of milk',
            foodId: 'food_1',
            // ⛔ The RESTATED pair still keys the row, because that is what nutrition is computed from and
            // what U14's reader holds in hand. The stated pair is carried BESIDE it, never instead of it.
            quantityLow: 0.5,
            quantityHigh: null,
            unit: 'cup',
            statedMeasure: { quantityLow: 1, quantityHigh: null, unit: 'gill' },
        });
    });

    it('carries BOTH stated bounds when the source printed a range', () => {
        const identity = verifiedLineIdentity(
            {
                sourceLine: 'one to two gills of milk',
                quantity: { kind: 'range', low: 0.5, high: 1 },
                unit: 'cup',
                statedMeasure: { quantity: { kind: 'range', low: 1, high: 2 }, unit: 'gill' },
            },
            'food_1',
        );

        expect(identity?.statedMeasure).toStrictEqual({ quantityLow: 1, quantityHigh: 2, unit: 'gill' });
    });

    // ⛔ THE PROPERTY THE `v2` BUMP EXISTS FOR. Both lines say the same thing about the same food and the same
    // persisted amount; only one of them records that the source printed a gill. They are DIFFERENT
    // judgements — the model is shown different numbers — so they must not share a verdict.
    it('⛔ a restated line and an un-restated line are DIFFERENT judgements', () => {
        const restated = verifiedLineIdentity(
            {
                sourceLine: 'one gill of milk',
                quantity: { kind: 'exact', value: 0.5 },
                unit: 'cup',
                statedMeasure: { quantity: { kind: 'exact', value: 1 }, unit: 'gill' },
            },
            'food_1',
        );
        const plain = verifiedLineIdentity(
            {
                sourceLine: 'one gill of milk',
                quantity: { kind: 'exact', value: 0.5 },
                unit: 'cup',
                statedMeasure: undefined,
            },
            'food_1',
        );

        expect(restated).toBeDefined();
        expect(plain).toBeDefined();
        expect(restated === undefined ? '' : verificationKeyPreimage(restated)).not.toBe(
            plain === undefined ? '' : verificationKeyPreimage(plain),
        );
    });

    it('carries BOTH bounds of a stated range', () => {
        const identity = verifiedLineIdentity(
            {
                sourceLine: '2 to 3 cups flour',
                quantity: { kind: 'range', low: 2, high: 3 },
                unit: 'cup',
                statedMeasure: undefined,
            },
            'food_1',
        );

        expect(identity).toMatchObject({ quantityLow: 2, quantityHigh: 3 });
    });

    it('carries an ABSENT quantity as two nulls — never a fabricated 0 or 1', () => {
        const identity = verifiedLineIdentity(
            { sourceLine: 'butter the size of an egg', quantity: ABSENT_QUANTITY, unit: '', statedMeasure: undefined },
            'food_1',
        );

        expect(identity).toMatchObject({ quantityLow: null, quantityHigh: null });
    });

    it('⛔ converts the unitless EMPTY STRING to null — the spelling the worker hashed', () => {
        const identity = verifiedLineIdentity(
            { sourceLine: '2 eggs', quantity: { kind: 'exact', value: 2 }, unit: '', statedMeasure: undefined },
            'food_1',
        );

        expect(identity?.unit).toBeNull();
        // Stated as a preimage assertion too, because the DIGEST — not the object — is what has to agree with
        // the worker. `'null]'` is the tail of the canonical JSON array, so this fails if `''` ever survives.
        expect(identity === undefined ? '' : verificationKeyPreimage(identity)).toContain('null]');
    });

    it('⛔ a unitless line and a line measured in `each` are DIFFERENT judgements', () => {
        const unitless = verifiedLineIdentity(
            { sourceLine: '2 eggs', quantity: { kind: 'exact', value: 2 }, unit: '', statedMeasure: undefined },
            'food_1',
        );
        const withUnit = verifiedLineIdentity(
            { sourceLine: '2 eggs', quantity: { kind: 'exact', value: 2 }, unit: 'each', statedMeasure: undefined },
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
            verifiedLineIdentity(
                { sourceLine: null, quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure: undefined },
                'food_1',
            ),
        ).toBeUndefined();
    });

    it('returns undefined when a source line is present but blank — there is nothing to judge', () => {
        expect(
            verifiedLineIdentity(
                { sourceLine: '   ', quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure: undefined },
                'food_1',
            ),
        ).toBeUndefined();
    });

    it('returns undefined for a freeform line that maps to no food', () => {
        expect(
            verifiedLineIdentity(
                {
                    sourceLine: '2 cups flour',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    statedMeasure: undefined,
                },
                undefined,
            ),
        ).toBeUndefined();
    });
});

describe('resolveLineStatus — which status one recipe line reports', () => {
    it('reports NEEDS_REVIEW when the gate CONTRADICTED the line, overriding the catalog mirror', () => {
        expect(resolveLineStatus('contradicted', FoodResolutionStatus.RESOLVED, 'none')).toBe(
            FoodResolutionStatus.NEEDS_REVIEW,
        );
    });

    it('reports NEEDS_REVIEW even when the catalog knows nothing about the food', () => {
        expect(resolveLineStatus('contradicted', undefined, 'none')).toBe(FoodResolutionStatus.NEEDS_REVIEW);
    });

    it('⛔ passes a VERIFIED line through unchanged — a verdict that agreed changes nothing', () => {
        expect(resolveLineStatus('verified', FoodResolutionStatus.RESOLVED, 'none')).toBe(
            FoodResolutionStatus.RESOLVED,
        );
    });

    it('⛔ passes an INCONCLUSIVE line through unchanged — abstention is not disagreement', () => {
        expect(resolveLineStatus('inconclusive', FoodResolutionStatus.PENDING, 'none')).toBe(
            FoodResolutionStatus.PENDING,
        );
    });

    it('⛔ ABSENCE OF A VERDICT MEANS PUBLISH — the line reports its catalog status alone (0023)', () => {
        expect(resolveLineStatus(undefined, FoodResolutionStatus.PENDING, 'none')).toBe(FoodResolutionStatus.PENDING);
    });

    it('reports nothing at all for an unjudged line with no catalog status', () => {
        expect(resolveLineStatus(undefined, undefined, 'none')).toBeUndefined();
    });

    it('is TOTAL over every band migration 0023 admits', () => {
        for (const band of VERIFICATION_BANDS) {
            expect(resolveLineStatus(band, FoodResolutionStatus.RESOLVED, 'none')).toBeDefined();
        }
    });
});

describe('pendingStateOf — KTD-A: zero-authority lexical binds WITHHOLD until the verdict (plan U4c)', () => {
    const NOW = new Date('2026-08-31T12:00:00.000Z');
    const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
    const lexicalZeroAuthority = (resolvedAt: Date) => ({ tier: 'lexical' as const, bandEpoch: null, resolvedAt });

    it('a fresh zero-authority lexical bind with no verdict is PENDING', () => {
        expect(pendingStateOf(undefined, lexicalZeroAuthority(hoursAgo(1)), NOW)).toBe('pending');
    });

    it('past the age bound it becomes AGED — the actionable needs-review treatment', () => {
        expect(
            pendingStateOf(undefined, lexicalZeroAuthority(hoursAgo(PENDING_VERIFICATION_MAX_AGE_HOURS + 1)), NOW),
        ).toBe('aged');
    });

    it('⛔ ANY verdict ends pending — verified, contradicted and inconclusive all have their own rules', () => {
        for (const band of VERIFICATION_BANDS) {
            expect(pendingStateOf(band, lexicalZeroAuthority(hoursAgo(1)), NOW)).toBe('none');
        }
    });

    it('⛔ curated and memo binds never pend — absence-means-publish changes for LEXICAL binds only', () => {
        expect(pendingStateOf(undefined, { tier: 'curated', bandEpoch: null, resolvedAt: hoursAgo(1) }, NOW)).toBe(
            'none',
        );
        expect(pendingStateOf(undefined, { tier: 'memo', bandEpoch: null, resolvedAt: hoursAgo(1) }, NOW)).toBe('none');
    });

    it("an AUTHORIZED-band bind (non-null epoch) publishes instantly — earned autonomy's payoff", () => {
        expect(pendingStateOf(undefined, { tier: 'lexical', bandEpoch: '2', resolvedAt: hoursAgo(1) }, NOW)).toBe(
            'none',
        );
    });

    it('a line with no recorded resolution keeps the shipped absence-means-publish semantics', () => {
        expect(pendingStateOf(undefined, undefined, NOW)).toBe('none');
    });
});

describe('isWithheldLine — pending and aged withhold macros exactly like a contradiction', () => {
    it('withholds a contradicted line whatever its pending state', () => {
        expect(isWithheldLine('contradicted', 'none')).toBe(true);
    });

    it('withholds pending AND aged — an aged line is still an unverified zero-authority bind', () => {
        expect(isWithheldLine(undefined, 'pending')).toBe(true);
        expect(isWithheldLine(undefined, 'aged')).toBe(true);
    });

    it('publishes a verified, an inconclusive, and an ordinary unjudged line', () => {
        expect(isWithheldLine('verified', 'none')).toBe(false);
        expect(isWithheldLine('inconclusive', 'none')).toBe(false);
        expect(isWithheldLine(undefined, 'none')).toBe(false);
    });
});

describe('resolveLineStatus — the pending members (plan U4c)', () => {
    it('a PENDING line reports PENDING_VERIFICATION, whatever the catalog says', () => {
        expect(resolveLineStatus(undefined, FoodResolutionStatus.RESOLVED, 'pending')).toBe(
            FoodResolutionStatus.PENDING_VERIFICATION,
        );
    });

    it('an AGED line adopts the actionable NEEDS_REVIEW treatment', () => {
        expect(resolveLineStatus(undefined, FoodResolutionStatus.RESOLVED, 'aged')).toBe(
            FoodResolutionStatus.NEEDS_REVIEW,
        );
    });

    it('a verdict outranks pending inputs — the switch is on the verdict first', () => {
        expect(resolveLineStatus('verified', FoodResolutionStatus.RESOLVED, 'none')).toBe(
            FoodResolutionStatus.RESOLVED,
        );
        expect(resolveLineStatus('contradicted', FoodResolutionStatus.RESOLVED, 'none')).toBe(
            FoodResolutionStatus.NEEDS_REVIEW,
        );
    });
});
