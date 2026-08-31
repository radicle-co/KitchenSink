/**
 * U12 — the pure promotion-candidacy policy (Q5 / D8): when do two authors' private foods TRIGGER a
 * moderation-queue entry, and which food is elected canonical on approval.
 *
 * ⛔ Corroboration is the TRIGGER, never the PUBLISHER (owner ruling 2026-08-30) — nothing in this policy
 * publishes; the decision it emits lands in an owner-visible queue and a human approves. What this table
 * proves is the GATE in front of that queue: under-age authors don't trigger, incompatible macros don't
 * trigger, and a rejected candidacy cannot re-enter without new data (the fingerprint).
 */
import { describe, expect, it } from 'vitest';

import {
    electCanonical,
    evaluatePromotionCandidacy,
    promotionFingerprint,
    PROMOTION_MACRO_TOLERANCE,
    PROMOTION_MIN_AUTHORS,
    PROMOTION_MIN_AUTHOR_TENURE_DAYS,
    type PromotionCandidateFood,
} from '../promotionPolicy.js';

const NOW = '2026-08-31T12:00:00.000Z';

/** An eligible candidate: tenured author, the shared reference macros. */
function candidate(overrides: Partial<PromotionCandidateFood> = {}): PromotionCandidateFood {
    return {
        foodId: '01JU12FOOD00000000000000AA',
        userId: '01JU12AUTHOR000000000000AA',
        createdAt: '2026-08-01T00:00:00.000Z',
        authorFirstSeenAt: '2026-06-01T00:00:00.000Z',
        macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
        ...overrides,
    };
}

const SECOND = candidate({
    foodId: '01JU12FOOD00000000000000BB',
    userId: '01JU12AUTHOR000000000000BB',
    createdAt: '2026-08-02T00:00:00.000Z',
});

function evaluate(
    candidates: readonly PromotionCandidateFood[],
    overrides: Partial<Parameters<typeof evaluatePromotionCandidacy>[0]> = {},
): ReturnType<typeof evaluatePromotionCandidacy> {
    return evaluatePromotionCandidacy({
        candidates,
        now: NOW,
        rejectedFingerprints: [],
        nameAlreadyClaimed: false,
        ...overrides,
    });
}

describe('evaluatePromotionCandidacy — the trigger gate', () => {
    it('two tenured authors with compatible macros TRIGGER a candidacy', () => {
        const decision = evaluate([candidate(), SECOND]);

        expect(decision.trigger).toBe(true);

        if (decision.trigger) {
            expect(decision.contributingFoodIds).toEqual(['01JU12FOOD00000000000000AA', '01JU12FOOD00000000000000BB']);
            expect(decision.fingerprint.length).toBeGreaterThan(0);
        }
    });

    it('ONE author never triggers, however many rows they wrote — the per-author dedup makes >1 impossible anyway', () => {
        const decision = evaluate([candidate(), candidate({ foodId: '01JU12FOOD00000000000000BB' })]);

        expect(decision.trigger).toBe(false);
    });

    it(`an author first seen under ${String(PROMOTION_MIN_AUTHOR_TENURE_DAYS)} days ago does NOT count`, () => {
        // The second author arrived yesterday: a throwaway account cannot corroborate its own sock.
        const decision = evaluate([candidate(), { ...SECOND, authorFirstSeenAt: '2026-08-30T12:00:00.000Z' }]);

        expect(decision.trigger).toBe(false);
    });

    it('incompatible macros do NOT trigger — beyond the tolerance on any one macro', () => {
        const spread = 1 + PROMOTION_MACRO_TOLERANCE * 2;
        const decision = evaluate([
            candidate(),
            { ...SECOND, macros: { calories: 100 * spread, proteinG: 10, carbsG: 20, fatG: 5 } },
        ]);

        expect(decision.trigger).toBe(false);
    });

    it('a single outlier does not BLOCK two compatible authors — the compatible set triggers without it', () => {
        const outlier = candidate({
            foodId: '01JU12FOOD00000000000000CC',
            userId: '01JU12AUTHOR000000000000CC',
            macros: { calories: 900, proteinG: 90, carbsG: 2, fatG: 70 },
        });
        const decision = evaluate([candidate(), SECOND, outlier]);

        expect(decision.trigger).toBe(true);

        if (decision.trigger) {
            expect(decision.contributingFoodIds).not.toContain('01JU12FOOD00000000000000CC');
        }
    });

    it('a rejected candidacy does NOT re-trigger on the same data — the fingerprint bars resubmission', () => {
        const first = evaluate([candidate(), SECOND]);

        if (!first.trigger) {
            throw new Error('fixture must trigger');
        }

        const decision = evaluate([candidate(), SECOND], { rejectedFingerprints: [first.fingerprint] });

        expect(decision.trigger).toBe(false);
    });

    it('NEW data re-triggers after a rejection — a third corroborating author changes the fingerprint', () => {
        const first = evaluate([candidate(), SECOND]);

        if (!first.trigger) {
            throw new Error('fixture must trigger');
        }

        const third = candidate({
            foodId: '01JU12FOOD00000000000000DD',
            userId: '01JU12AUTHOR000000000000DD',
        });
        const decision = evaluate([candidate(), SECOND, third], { rejectedFingerprints: [first.fingerprint] });

        expect(decision.trigger).toBe(true);
    });

    it('changed MACROS also count as new data', () => {
        const first = evaluate([candidate(), SECOND]);

        if (!first.trigger) {
            throw new Error('fixture must trigger');
        }

        const revised = { ...SECOND, macros: { calories: 105, proteinG: 10, carbsG: 20, fatG: 5 } };
        const decision = evaluate([candidate(), revised], { rejectedFingerprints: [first.fingerprint] });

        expect(decision.trigger).toBe(true);
    });

    it('a name already claimed (pending queue row, or a promoted/catalog food) never triggers', () => {
        const decision = evaluate([candidate(), SECOND], { nameAlreadyClaimed: true });

        expect(decision.trigger).toBe(false);
    });

    it('zero-valued macros agree only with zero — no division blow-up, no false compatibility', () => {
        const zeroA = candidate({ macros: { calories: 100, proteinG: 0, carbsG: 20, fatG: 5 } });
        const zeroB = { ...SECOND, macros: { calories: 100, proteinG: 0, carbsG: 20, fatG: 5 } };

        expect(evaluate([zeroA, zeroB]).trigger).toBe(true);

        const nonZero = { ...SECOND, macros: { calories: 100, proteinG: 3, carbsG: 20, fatG: 5 } };

        expect(evaluate([zeroA, nonZero]).trigger).toBe(false);
    });

    it(`the thresholds are the provisional calibration constants (${String(PROMOTION_MIN_AUTHORS)} authors, 10%)`, () => {
        // Q2-style calibration: the VALUES may move; the mechanism asserting them may not silently drift.
        expect(PROMOTION_MIN_AUTHORS).toBe(2);
        expect(PROMOTION_MACRO_TOLERANCE).toBe(0.1);
        expect(PROMOTION_MIN_AUTHOR_TENURE_DAYS).toBeGreaterThan(0);
    });
});

describe('promotionFingerprint — what "the same data" means', () => {
    it('is stable under candidate ORDER', () => {
        const forward = promotionFingerprint([candidate(), SECOND]);
        const reversed = promotionFingerprint([SECOND, candidate()]);

        expect(forward).toBe(reversed);
    });

    it('changes when a macro changes', () => {
        const base = promotionFingerprint([candidate(), SECOND]);
        const moved = promotionFingerprint([candidate(), { ...SECOND, macros: { ...SECOND.macros, calories: 101 } }]);

        expect(moved).not.toBe(base);
    });
});

describe('electCanonical — deterministic survivor', () => {
    it('elects the OLDEST contributing food, tiebreaking on id', () => {
        expect(electCanonical([SECOND, candidate()])).toBe('01JU12FOOD00000000000000AA');

        const sameInstant = { ...SECOND, createdAt: candidate().createdAt };

        expect(electCanonical([sameInstant, candidate()])).toBe('01JU12FOOD00000000000000AA');
    });

    it('throws on an empty set — election over nothing is a caller bug, not a default', () => {
        expect(() => electCanonical([])).toThrow();
    });
});
