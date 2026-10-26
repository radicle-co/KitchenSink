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
    identityAbstainedOf,
    identityContradictedOf,
    identityReadingOf,
    foodPresenceStatus,
    resolveLineStatus,
    viewerLineStatus,
    verifiedLineIdentity,
    verificationFoodNameOf,
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
            foodRefId: 'food_1',
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
            foodRefId: 'food_1',
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
        expect(
            resolveLineStatus('contradicted', FoodResolutionStatus.RESOLVED, {
                identityContradicted: false,
                identityAbstained: false,
            }),
        ).toBe(FoodResolutionStatus.NEEDS_REVIEW);
    });

    it('reports NEEDS_REVIEW even when the catalog knows nothing about the food', () => {
        expect(
            resolveLineStatus('contradicted', undefined, { identityContradicted: false, identityAbstained: false }),
        ).toBe(FoodResolutionStatus.NEEDS_REVIEW);
    });

    it('⛔ passes a VERIFIED line through unchanged — a verdict that agreed changes nothing', () => {
        expect(
            resolveLineStatus('verified', FoodResolutionStatus.RESOLVED, {
                identityContradicted: false,
                identityAbstained: false,
            }),
        ).toBe(FoodResolutionStatus.RESOLVED);
    });

    it('⛔ passes an INCONCLUSIVE line through unchanged — abstention is not disagreement', () => {
        expect(
            resolveLineStatus('inconclusive', FoodResolutionStatus.PENDING, {
                identityContradicted: false,
                identityAbstained: false,
            }),
        ).toBe(FoodResolutionStatus.PENDING);
    });

    it('⛔ ABSENCE OF A VERDICT MEANS PUBLISH — the line reports its catalog status alone (0023)', () => {
        expect(
            resolveLineStatus(undefined, FoodResolutionStatus.PENDING, {
                identityContradicted: false,
                identityAbstained: false,
            }),
        ).toBe(FoodResolutionStatus.PENDING);
    });

    it('reports nothing at all for an unjudged line with no catalog status', () => {
        expect(
            resolveLineStatus(undefined, undefined, { identityContradicted: false, identityAbstained: false }),
        ).toBeUndefined();
    });

    it('is TOTAL over every band migration 0023 admits', () => {
        for (const band of VERIFICATION_BANDS) {
            expect(
                resolveLineStatus(band, FoodResolutionStatus.RESOLVED, {
                    identityContradicted: false,
                    identityAbstained: false,
                }),
            ).toBeDefined();
        }
    });
});

/**
 * The re-pick arm (owner ruling 2026-08-31, U15 report "Owner rulings" §4): a HIGH-certainty IDENTITY
 * contradiction joins the U13 ambiguity-review surface — the pick affordance — instead of the passive
 * NEEDS_REVIEW badge. Nothing changes automatically: nutrition stays withheld (`isWithheld` reads the
 * band, not the status), and the owner re-picks or leaves it. A quantity-only dispute keeps the badge:
 * surfacing it for a food re-pick would ask a human to fix the wrong field.
 */
describe('resolveLineStatus — an identity contradiction invites the re-pick', () => {
    it('reports AMBIGUOUS for a contradicted line whose identity the model itemized as the dispute', () => {
        expect(
            resolveLineStatus('contradicted', FoodResolutionStatus.RESOLVED, {
                identityContradicted: true,
                identityAbstained: false,
            }),
        ).toBe(FoodResolutionStatus.AMBIGUOUS);
    });

    it('keeps NEEDS_REVIEW for a contradicted line with NO identity itemization — the pre-0042 population', () => {
        expect(
            resolveLineStatus('contradicted', FoodResolutionStatus.RESOLVED, {
                identityContradicted: false,
                identityAbstained: false,
            }),
        ).toBe(FoodResolutionStatus.NEEDS_REVIEW);
    });

    it('⛔ the flag reaches ONLY the contradicted arm — a verified line stays verified whatever it says', () => {
        expect(
            resolveLineStatus('verified', FoodResolutionStatus.RESOLVED, {
                identityContradicted: true,
                identityAbstained: false,
            }),
        ).toBe(FoodResolutionStatus.RESOLVED);
    });
});

/**
 * Owner ruling 2026-10-25 (ADR-0071 review, item 10): when the gate ABSTAINS on a saved line's IDENTITY, the line joins
 * the same ambiguity-review surface an identity contradiction does — the AMBIGUOUS badge — so the cook is invited to
 * look. Nutrition still publishes (`isWithheld` reads the band, and only `contradicted` withholds).
 */
describe('resolveLineStatus — an identity abstention keeps the AMBIGUOUS badge', () => {
    it('reports AMBIGUOUS for an inconclusive line whose IDENTITY the gate abstained on', () => {
        expect(
            resolveLineStatus('inconclusive', FoodResolutionStatus.RESOLVED, {
                identityContradicted: false,
                identityAbstained: true,
            }),
        ).toBe(FoodResolutionStatus.AMBIGUOUS);
    });

    it('keeps the catalog status for an inconclusive line whose identity was not the abstention', () => {
        expect(
            resolveLineStatus('inconclusive', FoodResolutionStatus.RESOLVED, {
                identityContradicted: false,
                identityAbstained: false,
            }),
        ).toBe(FoodResolutionStatus.RESOLVED);
    });

    it.each(['verified', 'contradicted'] as const)('⛔ the flag reaches ONLY the inconclusive arm — not %s', (band) => {
        expect(
            resolveLineStatus(band, FoodResolutionStatus.RESOLVED, {
                identityContradicted: false,
                identityAbstained: true,
            }),
        ).toBe(band === 'verified' ? FoodResolutionStatus.RESOLVED : FoodResolutionStatus.NEEDS_REVIEW);
    });
});

/**
 * Which verdicts badge a saved line AMBIGUOUS for an identity abstention (owner ruling 2026-10-25). Like the contradiction
 * arm beside it, only the model's ITEMIZED identity answer opens it: an unreadable answer is stored as a joint
 * `inconclusive` with no itemization, and a formatting failure is not the gate abstaining on the food.
 */
describe('identityAbstainedOf — which verdicts badge a saved line for an identity abstention', () => {
    it('fires on an itemized identity abstention that asked identity', () => {
        const row = {
            band: 'inconclusive',
            certainty: 'high',
            identityVerdict: 'abstain',
            aspects: ['identity', 'quantity'],
        } as const;

        expect(identityAbstainedOf(row)).toBe(true);
    });

    it.each([
        [
            '⛔ an unreadable answer (stored abstain, low, no itemization)',
            { band: 'inconclusive', certainty: 'low', identityVerdict: null, aspects: ['identity', 'quantity'] },
        ],
        [
            'a quantity-only abstention (identity agreed)',
            { band: 'inconclusive', certainty: 'high', identityVerdict: 'agree', aspects: ['identity', 'quantity'] },
        ],
        [
            'a verdict that never asked identity',
            { band: 'inconclusive', certainty: 'high', identityVerdict: 'abstain', aspects: ['quantity'] },
        ],
    ] as const)('does NOT fire on %s', (_label, row) => {
        expect(identityAbstainedOf(row)).toBe(false);
    });
});

/**
 * The ONE reading of a verdict's identity (ADR-0071 review, item 7), shared by the paste matcher's state and the saved
 * line's status so the two can never read the same row differently. A verdict whose aspects never included `identity`
 * says nothing about the food, whatever its band: it is `unasked`, never an agreement.
 */
describe('identityReadingOf — what one stored verdict says about the food', () => {
    const BOTH = ['identity', 'quantity'];

    it.each([
        ['an itemized agree', { band: 'verified', identityVerdict: 'agree', aspects: BOTH }, 'agree'],
        ['an itemized disagree', { band: 'contradicted', identityVerdict: 'disagree', aspects: BOTH }, 'disagree'],
        ['an itemized abstain', { band: 'inconclusive', identityVerdict: 'abstain', aspects: BOTH }, 'abstain'],
        [
            'a quantity dispute with identity agreed',
            { band: 'contradicted', identityVerdict: 'agree', aspects: BOTH },
            'agree',
        ],
        ['a joint verified, not itemized', { band: 'verified', identityVerdict: null, aspects: BOTH }, 'agree'],
        [
            'a joint contradicted, not itemized',
            { band: 'contradicted', identityVerdict: null, aspects: BOTH },
            'disagree',
        ],
        [
            'a joint inconclusive, not itemized',
            { band: 'inconclusive', identityVerdict: null, aspects: BOTH },
            'abstain',
        ],
        [
            '⛔ a verified band that never asked identity',
            { band: 'verified', identityVerdict: null, aspects: ['quantity'] },
            'unasked',
        ],
        [
            '⛔ a contradiction that never asked identity',
            { band: 'contradicted', identityVerdict: null, aspects: ['quantity'] },
            'unasked',
        ],
    ] as const)('reads %s', (_label, verdict, reading) => {
        expect(identityReadingOf(verdict)).toBe(reading);
    });
});

describe('identityContradictedOf — which verdicts open the re-pick door', () => {
    it('fires ONLY on a contradicted band with a high-certainty identity disagreement', () => {
        expect(identityContradictedOf({ band: 'contradicted', certainty: 'high', identityVerdict: 'disagree' })).toBe(
            true,
        );
    });

    it.each([
        ['the band is not contradicted', { band: 'verified', certainty: 'high', identityVerdict: 'disagree' }],
        ['certainty is only medium', { band: 'contradicted', certainty: 'medium', identityVerdict: 'disagree' }],
        [
            'identity itself agreed — a quantity-only dispute',
            { band: 'contradicted', certainty: 'high', identityVerdict: 'agree' },
        ],
        [
            'identity was never itemized (pre-0042 verdict)',
            { band: 'contradicted', certainty: 'high', identityVerdict: null },
        ],
    ])('does NOT fire when %s', (_label, row) => {
        expect(identityContradictedOf(row as Parameters<typeof identityContradictedOf>[0])).toBe(false);
    });
});

describe('viewerLineStatus — R20: a private food on a public recipe, seen by a stranger (plan U13)', () => {
    const AUTHOR = '01JU13AUTHOR00000000000AAA';
    const STRANGER = '01JU13STRANGER000000000BBB';

    it('a stranger sees RESOLVED_UNAVAILABLE, whatever the underlying status was', () => {
        expect(viewerLineStatus(FoodResolutionStatus.RESOLVED, AUTHOR, STRANGER)).toBe(
            FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        );
        // ⛔ Even the actionable states: a viewer who cannot ACCESS the food must get no pick affordance
        // and no needs-review invitation — name-only, never an error.
        expect(viewerLineStatus(FoodResolutionStatus.NEEDS_REVIEW, AUTHOR, STRANGER)).toBe(
            FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        );
        expect(viewerLineStatus(undefined, AUTHOR, STRANGER)).toBe(FoodResolutionStatus.RESOLVED_UNAVAILABLE);
    });

    it('the AUTHOR sees the underlying status untouched', () => {
        expect(viewerLineStatus(FoodResolutionStatus.AMBIGUOUS, AUTHOR, AUTHOR)).toBe(FoodResolutionStatus.AMBIGUOUS);
        expect(viewerLineStatus(undefined, AUTHOR, AUTHOR)).toBeUndefined();
    });

    it('a line whose food is not private passes through for everyone', () => {
        expect(viewerLineStatus(FoodResolutionStatus.RESOLVED, undefined, STRANGER)).toBe(
            FoodResolutionStatus.RESOLVED,
        );
        expect(viewerLineStatus(undefined, undefined, undefined)).toBeUndefined();
    });

    it('⛔ an UNKNOWN viewer on a private-food line is a stranger — privacy fails toward unavailable', () => {
        expect(viewerLineStatus(FoodResolutionStatus.RESOLVED, AUTHOR, undefined)).toBe(
            FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        );
    });
});

/**
 * `foodPresenceStatus` — the PRESENCE overlay (owner rulings 3 + 4, 2026-09-07; plan 002 R2, R9, R36).
 *
 * ⚠️ REWRITTEN for plan 002 U6. The overlay used to read food's live lifecycle status off the nutrition lookup,
 * and left a line unchanged when food could not be asked. Food's refs answer now also supplies a bound line's
 * NAME (the recipe database stores none), so a line food could not be asked about has no name, and the client
 * must be told why: it now reads `FOOD_UNREACHABLE`, which is transient and distinct from `FOOD_REMOVED`.
 *
 * ## ⛔ Where it sits in the overlay chain, and why that is load-bearing
 *
 *     resolveLineStatus(…) → foodPresenceStatus(…) → viewerLineStatus(…)   // viewer stays LAST
 *
 * If presence ran after the viewer overlay, a line that is `RESOLVED_UNAVAILABLE` to a stranger — a PRIVACY
 * answer — could be rewritten into `FOOD_REMOVED`, a FACTUAL claim about another user's catalog.
 */
describe('foodPresenceStatus — what food said about the line’s food on this read', () => {
    it('reports FOOD_REMOVED when the food was withdrawn or is gone', () => {
        expect(foodPresenceStatus(FoodResolutionStatus.RESOLVED, 'withdrawn')).toBe(FoodResolutionStatus.FOOD_REMOVED);
        expect(foodPresenceStatus(FoodResolutionStatus.RESOLVED, 'gone')).toBe(FoodResolutionStatus.FOOD_REMOVED);
    });

    it('⛔ overrides whatever status the line had so far, which is the point', () => {
        for (const earlier of [
            FoodResolutionStatus.RESOLVED,
            FoodResolutionStatus.NEEDS_REVIEW,
            FoodResolutionStatus.AMBIGUOUS,
            FoodResolutionStatus.PENDING_VERIFICATION,
            undefined,
        ]) {
            expect(foodPresenceStatus(earlier, 'withdrawn')).toBe(FoodResolutionStatus.FOOD_REMOVED);
        }
    });

    it('⛔ reports FOOD_UNREACHABLE — never FOOD_REMOVED — when food could not be asked', () => {
        // An outage is not a removal (R2): reporting one would turn a transient failure into a permanent-looking
        // claim that the cook's ingredient was deleted.
        for (const earlier of [FoodResolutionStatus.RESOLVED, FoodResolutionStatus.NEEDS_REVIEW, undefined]) {
            expect(foodPresenceStatus(earlier, 'unreachable')).toBe(FoodResolutionStatus.FOOD_UNREACHABLE);
        }
    });

    it('leaves the status unchanged for a present food and for an unresolved line — the positive control', () => {
        for (const earlier of [FoodResolutionStatus.NEEDS_REVIEW, FoodResolutionStatus.PENDING, undefined]) {
            expect(foodPresenceStatus(earlier, 'present')).toBe(earlier);
            expect(foodPresenceStatus(earlier, 'unbound')).toBe(earlier);
        }
    });
});

describe('⛔ the overlay ORDER — a privacy answer must never become a factual one', () => {
    it('a stranger on a private food still sees RESOLVED_UNAVAILABLE, not FOOD_REMOVED', () => {
        // The composition the read path performs, in order. `viewerLineStatus` runs LAST and wins.
        const status = viewerLineStatus(
            foodPresenceStatus(FoodResolutionStatus.RESOLVED, 'withdrawn'),
            'author-1',
            'someone-else',
        );

        expect(status).toBe(FoodResolutionStatus.RESOLVED_UNAVAILABLE);
    });

    it('the food`s OWN author still learns it was withdrawn', () => {
        const status = viewerLineStatus(
            foodPresenceStatus(FoodResolutionStatus.RESOLVED, 'withdrawn'),
            'author-1',
            'author-1',
        );

        expect(status).toBe(FoodResolutionStatus.FOOD_REMOVED);
    });
});

describe('verificationFoodNameOf — the name the gate judges a line against (curated U9)', () => {
    const AT = new Date('2026-09-30T00:00:00.000Z');
    const ROOT_ARM = { kind: 'root', lookupId: 'l1', foodId: 'food-1', foodOwnerId: null, createdAt: AT } as const;

    it('is the root’s name for a root line', () => {
        expect(
            verificationFoodNameOf({
                arm: ROOT_ARM,
                name: 'beef brisket',
                presence: 'present',
                food: { rootId: 'food-1' },
            }),
        ).toBe('beef brisket');
    });

    it('is the root’s name with the variant’s parts for a variant line — the model judges the variant', () => {
        expect(
            verificationFoodNameOf({
                arm: { kind: 'variant', lookupId: 'l2', foodVariantId: 'V-flat', createdAt: AT },
                name: 'beef brisket',
                presence: 'present',
                food: {
                    rootId: 'R-brisket',
                    variant: {
                        id: 'V-flat',
                        parts: [
                            { attribute: 'cut', text: 'flat' },
                            { attribute: 'trim', text: 'separable lean' },
                        ],
                    },
                },
            }),
        ).toBe('beef brisket (flat, separable lean)');
    });

    it('is nothing for a line with no name to show', () => {
        expect(verificationFoodNameOf({ arm: ROOT_ARM, name: undefined, presence: 'unreachable' })).toBeUndefined();
    });
});
