/**
 * @module @commise/features-recipes — the words of the pinned ingredients bar (owner ruling R1,
 * `docs/plans/2026-11-08-pinnedIngredientsBar.md`). One pure derivation for both platforms, so the web bar and the native
 * bar say the same thing and name their one button the same way.
 */
import type { Locale } from '@commise/i18n';

import { fillTemplate } from '../format/fillTemplate.js';
import type { RecipeDetailMessages } from '../messages.js';

/** What the bar and its list say. */
export interface PinnedBarFacts {
    /** Line 1, the label: "Ingredients". */
    readonly heading: string;
    /** Line 1, the quiet part: "for 4". */
    readonly forServings: string;
    /** Line 2: "13 items", or "13 items · 1 ticked" once something is ticked. */
    readonly meta: string;
    /** The cue at the end: "Show" while closed, "Hide" while open. */
    readonly cue: string;
    /** The one button's accessible name. It starts with the visible words (WCAG 2.5.3). */
    readonly name: string;
    /** The opened list's dialog name. */
    readonly dialogName: string;
    /** What pressing the bar does, for native, which has no aria-haspopup. */
    readonly hint: string;
}

/** What {@link pinnedBarFactsOf} reads. */
export interface PinnedBarFactsInput {
    /** The recipe's lines. A line is an item; a group heading is not. */
    readonly ingredients: readonly { readonly ingredientId: string }[];
    /** The ids the cook has ticked. An id with no line (a stale mark) is not counted. */
    readonly checked: ReadonlySet<string>;
    /** The serving count the page shows. */
    readonly servings: number;
    /** Whether the list is open. */
    readonly open: boolean;
    readonly copy: Pick<
        RecipeDetailMessages,
        | 'ingredientsHeading'
        | 'ingredientsFor'
        | 'pinnedItemsOne'
        | 'pinnedItemsOther'
        | 'pinnedTicked'
        | 'pinnedMeta'
        | 'pinnedSummaryTicked'
        | 'pinnedShow'
        | 'pinnedHide'
        | 'pinnedNameShow'
        | 'pinnedNameHide'
        | 'pinnedDialogName'
        | 'pinnedHintShow'
        | 'pinnedHintHide'
    >;
    readonly locale: Locale;
}

/**
 * What the pinned bar says for the page as it stands.
 *
 * @param input - The lines, the ticks, the servings, whether the list is open, the copy and the locale.
 * @returns The bar's words and its button's name.
 */
export const pinnedBarFactsOf = ({
    ingredients,
    checked,
    servings,
    open,
    copy,
    locale,
}: PinnedBarFactsInput): PinnedBarFacts => {
    const count = ingredients.length;
    const ticked = ingredients.filter((line) => checked.has(line.ingredientId)).length;
    const format = new Intl.NumberFormat(locale);
    const items = fillTemplate(
        new Intl.PluralRules(locale).select(count) === 'one' ? copy.pinnedItemsOne : copy.pinnedItemsOther,
        {
            count: format.format(count),
        },
    );
    const tickedText = fillTemplate(copy.pinnedTicked, { count: format.format(ticked) });
    // The servings are formatted for the locale like the counts are (digits, grouping).
    const servingsText = format.format(servings);
    // Display only: "for 4" is drawn with a no-break space so it never splits, and the label wraps between the words instead.
    const forServings = fillTemplate(copy.ingredientsFor, { count: servingsText }).replace(/ /gu, '\u00a0');
    const summary = ticked === 0 ? items : fillTemplate(copy.pinnedSummaryTicked, { items, ticked: tickedText });

    return {
        heading: copy.ingredientsHeading,
        forServings,
        meta: ticked === 0 ? items : fillTemplate(copy.pinnedMeta, { items, ticked: tickedText }),
        cue: open ? copy.pinnedHide : copy.pinnedShow,
        name: fillTemplate(open ? copy.pinnedNameHide : copy.pinnedNameShow, { count: servingsText, summary }),
        hint: open ? copy.pinnedHintHide : copy.pinnedHintShow,
        dialogName: fillTemplate(copy.pinnedDialogName, { count: servingsText }),
    };
};
