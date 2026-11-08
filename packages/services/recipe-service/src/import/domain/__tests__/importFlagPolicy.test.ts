/**
 * Truth table for the third mapping over `identityReadingOf`: every reading, every review state, every default shape.
 */
import { describe, expect, it } from 'vitest';

import { IDENTITY_READINGS, type IdentityReading } from '../../../recipes/domain/lineVerification.js';
import type { MatchFacts } from '../../../recipes/domain/matchState.js';
import { importFlagOf } from '../importFlagPolicy.js';

const REVIEWS: readonly MatchFacts['review'][] = ['asked', 'refused', 'exhausted', 'notAsked'];

const flag = (reading: IdentityReading, review: MatchFacts['review'] = 'asked', defaultFoodId?: string) =>
    importFlagOf({ reading, review, boundFoodId: 'bound', defaultFoodId });

describe('importFlagOf', () => {
    it('knows every reading (the table below is complete)', () => {
        expect([...IDENTITY_READINGS].sort()).toEqual(
            ['abstain', 'agree', 'contradict', 'doubt', 'hedged', 'unasked', 'unreadable'].sort(),
        );
    });

    it.each(['contradict', 'doubt', 'hedged', 'abstain', 'unreadable'] as const)(
        'flags %s in every review state',
        (r) => {
            for (const review of REVIEWS) {
                expect(flag(r, review).state).toBe('flagged');
            }
        },
    );

    it('clears agree in every review state', () => {
        for (const review of REVIEWS) {
            expect(flag('agree', review)).toEqual({ state: 'clear' });
        }
    });

    it('reads unasked as checking while the review is still owed', () => {
        expect(flag('unasked', 'asked')).toEqual({ state: 'checking' });
    });

    it.each(['refused', 'exhausted', 'notAsked'] as const)(
        'flags unasked when the review is %s, because it will never come',
        (review) => {
            expect(flag('unasked', review).state).toBe('flagged');
        },
    );

    describe('suggestion', () => {
        it('is the default candidate when it differs from the bound food', () => {
            expect(flag('contradict', 'asked', 'salt')).toEqual({ state: 'flagged', suggestionFoodId: 'salt' });
        });

        it('is none when the default is the bound food', () => {
            expect(flag('doubt', 'asked', 'bound')).toEqual({ state: 'flagged', suggestionFoodId: undefined });
        });

        it('is none when there is no default', () => {
            expect(flag('hedged')).toEqual({ state: 'flagged', suggestionFoodId: undefined });
        });

        it('is never offered on a clear or checking line', () => {
            expect(flag('agree', 'asked', 'salt')).toEqual({ state: 'clear' });
            expect(flag('unasked', 'asked', 'salt')).toEqual({ state: 'checking' });
        });
    });
});
