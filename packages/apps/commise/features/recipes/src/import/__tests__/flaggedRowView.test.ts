/**
 * Unit tests for `flaggedRowView.ts`: what a flagged row shows about a send. Its failure is the matched-line list's,
 * hidden while a retry is in flight (one rule, `lineFailureOf`); its send state tells a retry from a first attempt; and
 * where a retry lands focus is the Use it made busy, or Choose another when the check offered no food and the row has no
 * Use (WCAG 2.4.3).
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { matchLineMessages } from '../../ingredientMatching/messages.js';
import { flaggedRowViewOf } from '../flaggedRowView.js';
import type { ImportFlaggedLineItem } from '../props.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const WITH_USE: ImportFlaggedLineItem = {
    key: 'milk',
    text: '1 1/4 cups milk',
    recipeTitle: 'Pancakes',
    matchedFood: 'milk crackers',
    suggestion: { foodId: 'f-whole', name: 'Whole milk' },
};
const WITHOUT_USE: ImportFlaggedLineItem = { ...WITH_USE, key: 'spice', suggestion: undefined };

describe('flaggedRowViewOf', () => {
    it('lands on Use when the check offered a food', () => {
        expect(flaggedRowViewOf(WITH_USE, { failed: false, pending: undefined }, copy).landing).toBe('use');
    });

    it('lands on Choose another when the row has no Use', () => {
        expect(flaggedRowViewOf(WITHOUT_USE, { failed: false, pending: undefined }, copy).landing).toBe(
            'chooseAnother',
        );
    });

    it('says the failure in the matched-line list’s words, named for the line', () => {
        expect(flaggedRowViewOf(WITH_USE, { failed: true, pending: undefined }, copy).failure).toEqual({
            text: 'We couldn’t save that choice.',
            retry: { label: 'Try again', name: 'Try again to save the choice for 1 1/4 cups milk' },
        });
    });

    it('hides the failure while a retry is in flight, and says a send is in flight', () => {
        const view = flaggedRowViewOf(WITH_USE, { failed: true, pending: { kind: 'useProposal' } }, copy);

        expect(view.failure).toBeUndefined();
        expect(view.send).toEqual({ key: 'milk', failed: true, sending: true });
    });

    it('says nothing failed and nothing is sending for a quiet row', () => {
        const view = flaggedRowViewOf(WITH_USE, { failed: false, pending: undefined }, copy);

        expect(view.failure).toBeUndefined();
        expect(view.send).toEqual({ key: 'milk', failed: false, sending: false });
    });
});
