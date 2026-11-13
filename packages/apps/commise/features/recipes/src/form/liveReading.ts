/**
 * @module @commise/features-recipes/form — the add field's live reading (build spec §7.5.3): the one caption line under
 * the field that shows how the cook's text was read ("2 tbsp · olive oil · for frying"), and the sentence a screen
 * reader hears for it ("Amount 2, unit tablespoon, food olive oil, preparation for frying."). The reading is
 * `readLeadingMeasure`'s; this only words it.
 *
 * Pure and platform-agnostic: both leaves draw it.
 */
import type { Locale } from '@commise/i18n';

import { formatQuantity } from '../detail/model.js';
import { speakAmounts } from '../format/cookAmount.js';
import { fillTemplate } from '@commise/i18n';
import type { AmountWordMessages } from '../messages.js';
import { readLeadingMeasure } from './leadingMeasure.js';

/** The four part templates, already localised (`editorMessages.ingredients.reading`). */
export interface LiveReadingCopy {
    readonly amount: string;
    readonly unit: string;
    readonly food: string;
    readonly prep: string;
}

/** What the caption shows, and what a screen reader hears for it. */
export interface LiveReading {
    readonly shown: string;
    readonly spoken: string;
}

/**
 * The live reading of the add field's text.
 *
 * @param text - The field's text.
 * @param locale - The active locale, for the amount.
 * @param copy - The part templates.
 * @param words - The words for an amount's fractions, so the spoken amount never says a fraction character.
 * @returns The reading, or `undefined` when the text is only a food: the field already shows that.
 */
export function liveReadingOf(
    text: string,
    locale: Locale,
    copy: LiveReadingCopy,
    words: AmountWordMessages,
): LiveReading | undefined {
    const { quantity, unit, search, preparation, measureText } = readLeadingMeasure(text);

    if (measureText === '' && preparation === '') {
        return undefined;
    }

    const spokenParts = [
        quantity.kind === 'absent'
            ? ''
            : fillTemplate(copy.amount, { amount: speakAmounts(formatQuantity(quantity, locale), words) }),
        unit === '' ? '' : fillTemplate(copy.unit, { unit }),
        search === '' ? '' : fillTemplate(copy.food, { food: search }),
        preparation === '' ? '' : fillTemplate(copy.prep, { prep: preparation }),
    ].filter((part) => part !== '');

    return {
        shown: [measureText, search, preparation].filter((part) => part !== '').join(' · '),
        spoken: `${spokenParts.join(', ')}.`,
    };
}
