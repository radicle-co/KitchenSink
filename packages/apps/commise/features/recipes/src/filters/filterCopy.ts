/**
 * @module @commise/features-recipes/filters — the sheet primary's sentence, once for both platforms.
 *
 * Pure.
 */
import { formatRecipeCount } from '../list/model.js';
import type { FilterMessages } from './messages.js';
import type { Locale } from '@commise/i18n';

/**
 * "Show 12 recipes". The count is the live number of recipes the filters leave, so the sheet's primary says what closing
 * it will show.
 *
 * @param count - How many recipes the filters leave, or `undefined` while no search has settled.
 * @param copy - The filters' copy.
 * @param locale - The locale whose plural rules count them.
 * @returns The button's text.
 */
export function showResultsLabel(count: number | undefined, copy: FilterMessages, locale: Locale): string {
    return count === undefined
        ? copy.showResultsUnknown
        : formatRecipeCount(count, { one: copy.showResultsOne, other: copy.showResultsOther }, locale);
}
