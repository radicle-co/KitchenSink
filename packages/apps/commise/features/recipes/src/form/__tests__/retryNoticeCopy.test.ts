/**
 * Owner ruling T7 (2026-10-29): a notice that has a Try again button below it says only what went wrong. These are the
 * form notices drawn beside such a button: the nutrition read's failure, the food lookup's failure panel, and the
 * paste block's refused retry.
 */
import { describe, expect, it } from 'vitest';

import { recipeFormMessages } from '../messages.js';

const en = recipeFormMessages.en;

describe('form notices that sit above a Try again button', () => {
    it.each([
        ['nutritionLoadFailed', en.nutritionLoadFailed, 'We couldn’t load the nutrition just now.'],
        [
            'statusExplainFailed',
            en.statusExplainFailed,
            'We couldn’t reach the food database. Nothing is wrong with your ingredient.',
        ],
        [
            'pasteRetryFailed',
            en.pasteRetryFailed,
            'Couldn’t try again. Check your connection, or add the lines as written.',
        ],
    ])('%s says what went wrong and does not ask for a retry', (_key, actual, expected) => {
        expect(actual).toBe(expected);
        expect(actual).not.toMatch(/try again in a moment|try again\.?$/i);
    });
});
