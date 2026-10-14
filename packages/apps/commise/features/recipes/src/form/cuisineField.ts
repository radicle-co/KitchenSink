/**
 * @module @commise/features-recipes/form — the Cuisine field's list, as a pure function of its text
 * (`docs/design/uiOverhaul/cuisineField.md` §3.1, owner rulings 2026-10-13).
 *
 * The field follows the APG's "list autocomplete with manual selection": the typed text IS the value unless the cook
 * picks an entry. So the list offers the matching entries and, when the text is not itself an entry, the cook's own
 * words as one more option, "Use “…”", in the canonical form it will be saved in. The primitive owns only whether the
 * list shows (`@commise/ui/combobox`); everything here is the host's.
 *
 * Pure and platform-agnostic: shared unchanged by the web and native leaves through `useCuisineField`, so the two can
 * never offer different lists or say different things.
 */
import type { ComboboxGroup, ComboboxStatus } from '@commise/ui/combobox';
import { canonicalCuisine, cuisineEntryOf } from '@kitchensink/recipe-core';

import { pluralOf } from '../editor/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { RecipeFormMessages } from './messages.js';
import { cuisineSuggestions } from './props.js';

/**
 * The key of the "Use “…”" option. Not a cuisine: a list entry is its own key, and no entry can start with `::`
 * (asserted by the test).
 */
export const CUISINE_USE_OWN_KEY = '::use-own';

/** The copy the list speaks. */
export type CuisineFieldMessages = Pick<
    RecipeFormMessages,
    'cuisineSuggestionCount' | 'cuisineNoMatch' | 'cuisineNotListedHeading' | 'cuisineUseOwn' | 'cuisineUseOwnName'
>;

/** What the list is derived from. */
export interface CuisineFieldViewInput {
    /** The field's text. */
    readonly text: string;
    /**
     * Whether the text filters the list: only after the cook's first edit since the field took focus (§3, "Filter text
     * is not the value"), so a cook who picked "Thai" can browse the whole list again without clearing it.
     */
    readonly filtering: boolean;
    readonly messages: CuisineFieldMessages;
    readonly locale: string;
}

/** The list the combobox shows, and what its polite region says about it. */
export interface CuisineFieldView {
    readonly groups: readonly ComboboxGroup[];
    /** The note shown before the options when nothing matches (S5). */
    readonly status?: ComboboxStatus;
    /** What the list holds for the text: the count, or the no-match note (4.1.3). */
    readonly announcement: string;
}

/**
 * The list for the field's text. Pure.
 *
 * - Not filtering, or blank: every entry (S2, S6, S7).
 * - Text that names an entry: the matches, with no Use option, because the entry is the value (S4).
 * - Text with matches: the matches, then a "Not listed?" group holding the Use option (S3).
 * - Text with none: the note, then the Use option alone (S5). The note says it, so the group has no heading.
 *
 * @param input - The text, whether it filters, and the copy.
 * @returns The groups, the note and the announcement.
 */
export function cuisineFieldView(input: CuisineFieldViewInput): CuisineFieldView {
    const { messages, locale } = input;
    const own = canonicalCuisine(input.text);
    const filter = input.filtering ? own : '';
    const matches = cuisineSuggestions(filter).map((cuisine) => ({ key: cuisine, label: cuisine }));
    const count = pluralOf(messages.cuisineSuggestionCount, matches.length, locale);

    if (filter === '' || cuisineEntryOf(own) !== undefined) {
        return { groups: [{ key: 'cuisines', options: matches }], announcement: count };
    }

    const useOwn = {
        key: CUISINE_USE_OWN_KEY,
        label: fillTemplate(messages.cuisineUseOwn, { text: own }),
        accessibleName: fillTemplate(messages.cuisineUseOwnName, { text: own }),
    };

    if (matches.length === 0) {
        const note = fillTemplate(messages.cuisineNoMatch, { text: own });

        return {
            groups: [{ key: 'own', options: [useOwn] }],
            status: { kind: 'note', text: note },
            announcement: note,
        };
    }

    return {
        groups: [
            { key: 'cuisines', options: matches },
            { key: 'own', label: messages.cuisineNotListedHeading, options: [useOwn] },
        ],
        announcement: count,
    };
}

/**
 * The value a pick commits: an entry as the list spells it, or, for the Use option, the cook's own words in their
 * canonical form. Pure.
 *
 * @param key - The chosen option's key.
 * @param text - The field's text when it was chosen.
 * @returns The cuisine to put in the form.
 */
export function cuisineCommitOf(key: string, text: string): string {
    return key === CUISINE_USE_OWN_KEY ? canonicalCuisine(text) : key;
}
