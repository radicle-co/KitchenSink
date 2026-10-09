/**
 * Unit tests for the add field's live reading (`form/liveReading.ts`; build spec §7.5.3): the caption under the field
 * that shows how the cook's text was read, and the sentence a screen reader hears for it.
 */
import { describe, expect, it } from 'vitest';

import { liveReadingOf, type LiveReadingCopy } from '../liveReading.js';

const COPY: LiveReadingCopy = {
    amount: 'Amount {amount}',
    unit: 'unit {unit}',
    food: 'food {food}',
    prep: 'preparation {prep}',
};

describe('liveReadingOf', () => {
    it('shows the parts as typed, joined by a middle dot, and names each part for a screen reader', () => {
        expect(liveReadingOf('2 tbsp olive oil, for frying', 'en', COPY)).toEqual({
            shown: '2 tbsp · olive oil · for frying',
            spoken: 'Amount 2, unit tablespoon, food olive oil, preparation for frying.',
        });
    });

    it('a range is spoken as the read surface prints it', () => {
        expect(liveReadingOf('2-3 cloves garlic', 'en', COPY)).toEqual({
            shown: '2-3 cloves · garlic',
            spoken: 'Amount 2–3, unit clove, food garlic.',
        });
    });

    it('names only the parts the text states', () => {
        expect(liveReadingOf('2 eggs', 'en', COPY)).toEqual({ shown: '2 · eggs', spoken: 'Amount 2, food eggs.' });
        expect(liveReadingOf('salt, to taste', 'en', COPY)).toEqual({
            shown: 'salt · to taste',
            spoken: 'food salt, preparation to taste.',
        });
    });

    it('shows nothing when the text is only a food: the field already says that', () => {
        expect(liveReadingOf('olive oil', 'en', COPY)).toBeUndefined();
        expect(liveReadingOf('   ', 'en', COPY)).toBeUndefined();
    });

    it('formats the amount for the locale', () => {
        expect(liveReadingOf('1 1/2 cups flour', 'de', COPY)?.spoken).toBe('Amount 1,5, unit cup, food flour.');
    });
});
