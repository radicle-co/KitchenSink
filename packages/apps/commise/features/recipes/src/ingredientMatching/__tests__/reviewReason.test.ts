/**
 * Unit tests for `reviewReason.ts`: the cook-facing words for a server `reason` key, shown by "See why" after a late
 * review result (ADR-0071 section 9: the key is opaque and the client localises it). Seen red first.
 *
 * The reasons that can sit under a CONFIDENT proposal are the ones a late note is about (`matchState.ts`); every other
 * key, including one a newer server adds, reads the general sentence rather than raw code or nothing.
 */
import { describe, expect, it } from 'vitest';

import { matchLineMessages } from '../messages.js';
import { reviewReasonOf } from '../reviewReason.js';

const copy = matchLineMessages.en;

describe('reviewReasonOf', () => {
    it.each(['exactName', 'curatedMapping', 'rememberedMatch', 'reviewVerified'] as const)(
        'says why a %s match was proposed, in its own words',
        (reason) => {
            expect(reviewReasonOf(copy, reason)).toBe(copy.reasons[reason]);
            expect(reviewReasonOf(copy, reason)).not.toBe(copy.reasonFallback);
        },
    );

    it('⛔ never shows a raw key: an unknown or newer reason reads the general sentence', () => {
        expect(reviewReasonOf(copy, 'someFutureReason')).toBe(copy.reasonFallback);
        expect(reviewReasonOf(copy, '')).toBe(copy.reasonFallback);
    });

    it('does not read a key off the prototype', () => {
        expect(reviewReasonOf(copy, 'constructor')).toBe(copy.reasonFallback);
        expect(reviewReasonOf(copy, 'toString')).toBe(copy.reasonFallback);
    });

    it('gives each known reason a different sentence, so the cook can tell them apart', () => {
        const sentences = new Set(
            ['exactName', 'curatedMapping', 'rememberedMatch', 'reviewVerified'].map((r) => reviewReasonOf(copy, r)),
        );

        expect(sentences.size).toBe(4);
    });
});

/**
 * ADDED for the AI budget spent (owner ruling 2026-10-26): the server's `reviewBudgetSpent` reason is the per-line reason
 * "See why" opens on a line matched without the check. It has its own sentence, and the fallback reads the owner's
 * 2026-10-26 words.
 */
describe('reviewReasonOf — the AI budget spent', () => {
    it('says the check did not run this month, in its own words', () => {
        expect(reviewReasonOf(copy, 'reviewBudgetSpent')).toBe(
            'Our check did not run this month, so this is our best guess. Choose the food you use.',
        );
    });

    it('the general sentence is the owner’s 2026-10-26 wording', () => {
        expect(copy.reasonFallback).toBe('Our check suggested this food for your line.');
    });
});
