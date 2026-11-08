/**
 * Unit tests for the add field's live reading (`form/liveReading.ts`; build spec §7.5.3): the caption under the field
 * that shows how the cook's text was read, and the sentence a screen reader hears for it.
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { liveReadingOf, type LiveReadingCopy } from '../liveReading.js';

const WORDS = recipeMessages.en.amountWords;

const COPY: LiveReadingCopy = {
    amount: 'Amount {amount}',
    unit: 'unit {unit}',
    food: 'food {food}',
    prep: 'preparation {prep}',
};

describe('liveReadingOf', () => {
    it('shows the parts as typed, joined by a middle dot, and names each part for a screen reader', () => {
        expect(liveReadingOf('2 tbsp olive oil, for frying', 'en', COPY, WORDS)).toEqual({
            shown: '2 tbsp · olive oil · for frying',
            spoken: 'Amount 2, unit tablespoon, food olive oil, preparation for frying.',
        });
    });

    // Rewritten for Q5: the read surface prints "2–3", and a screen reader now hears the range words, not the dash.
    it('a range is spoken with the range words', () => {
        expect(liveReadingOf('2-3 cloves garlic', 'en', COPY, WORDS)).toEqual({
            shown: '2-3 cloves · garlic',
            spoken: 'Amount 2 to 3, unit clove, food garlic.',
        });
    });

    // E15: a count unit typed after the food is shown and spoken as the unit it is, and not dropped into the food.
    it('reads a count unit typed after the food as the unit: "3 garlic cloves"', () => {
        expect(liveReadingOf('3 garlic cloves', 'en', COPY, WORDS)).toEqual({
            shown: '3 cloves · garlic',
            spoken: 'Amount 3, unit clove, food garlic.',
        });
        expect(liveReadingOf('2 whole cloves', 'en', COPY, WORDS)).toEqual({
            shown: '2 · whole cloves',
            spoken: 'Amount 2, food whole cloves.',
        });
    });

    it('names only the parts the text states', () => {
        expect(liveReadingOf('2 eggs', 'en', COPY, WORDS)).toEqual({
            shown: '2 · eggs',
            spoken: 'Amount 2, food eggs.',
        });
        expect(liveReadingOf('salt, to taste', 'en', COPY, WORDS)).toEqual({
            shown: 'salt · to taste',
            spoken: 'food salt, preparation to taste.',
        });
    });

    it('shows nothing when the text is only a food: the field already says that', () => {
        expect(liveReadingOf('olive oil', 'en', COPY, WORDS)).toBeUndefined();
        expect(liveReadingOf('   ', 'en', COPY, WORDS)).toBeUndefined();
    });

    /** UI Designer ruling Q5: a screen reader hears a fraction in words, never the character. */
    it('says a fraction in words in English', () => {
        expect(liveReadingOf('1 1/2 cups flour', 'en', COPY, WORDS)?.spoken).toBe(
            'Amount 1 and a half, unit cup, food flour.',
        );
    });

    it('formats the amount for the locale', () => {
        expect(liveReadingOf('1 1/2 cups flour', 'de', COPY, WORDS)?.spoken).toBe('Amount 1,5, unit cup, food flour.');
    });
});
