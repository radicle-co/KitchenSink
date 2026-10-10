/**
 * @module @commise/features-recipes/collections — the add-recipes picker's pure rules
 * (`docs/design/uiOverhaul/buildSpec.md` §5.3; blueprint A15).
 *
 * The Done button's "2 added, 1 removed" is a SET DIFFERENCE between the members when the picker opened and the members
 * now, never a count of presses: on → off → on is no change, and counting events would read it as one add and one
 * remove. Pure.
 */
import { fillTemplate } from '../format/fillTemplate.js';
import type { CollectionRecipePickerMessages } from './messages.js';

/** What the cook changed while the picker was open. */
export interface PickerSummary {
    readonly added: number;
    readonly removed: number;
}

/**
 * What changed between the members at open and the members now.
 *
 * @param atOpen - The member recipe ids when the picker opened.
 * @param now - The member recipe ids now.
 * @returns How many recipes are members now that were not, and how many were members that no longer are.
 */
export function doneSummaryOf(atOpen: readonly string[], now: readonly string[]): PickerSummary {
    const before = new Set(atOpen);
    const after = new Set(now);

    return {
        added: [...after].filter((id) => !before.has(id)).length,
        removed: [...before].filter((id) => !after.has(id)).length,
    };
}

/**
 * The Done button's text: "Done", or "Done · 2 added, 1 removed" with a zero part left out.
 *
 * @param summary - What changed while the picker was open.
 * @param copy - The picker's copy.
 * @returns The label.
 */
export function doneLabelOf(
    summary: PickerSummary,
    copy: Pick<CollectionRecipePickerMessages, 'done' | 'doneWithCount' | 'addedCount' | 'removedCount'>,
): string {
    const parts = [
        ...(summary.added > 0 ? [fillTemplate(copy.addedCount, { count: summary.added })] : []),
        ...(summary.removed > 0 ? [fillTemplate(copy.removedCount, { count: summary.removed })] : []),
    ];

    return parts.length === 0 ? copy.done : fillTemplate(copy.doneWithCount, { summary: parts.join(', ') });
}

/**
 * The recipes whose title holds the search term, in the order given.
 *
 * @param recipes - The cook's recipes.
 * @param term - The raw search term.
 * @returns The matches; all of them for a blank term.
 */
export function narrowByTitle<T extends { readonly title: string }>(recipes: readonly T[], term: string): readonly T[] {
    const needle = term.trim().toLowerCase();

    return needle.length === 0 ? recipes : recipes.filter((recipe) => recipe.title.toLowerCase().includes(needle));
}
