/**
 * @module @commise/features-recipes/editor — the publish step's note about ingredient lines with no match (build spec
 * §7.2; owner D20, 2026-10-10).
 *
 * The recipe service publishes a recipe whose lines have no matched food, and those lines count as zero toward
 * nutrition. Publish therefore stays enabled, and the editor says so: the action bar's ready text and a quiet note in
 * Photos & publish carry the one sentence this returns. ⛔ The decision lives here once; both leaves draw its text.
 *
 * ⛔ The count is {@link lineNeedsAttention}'s — the same rule that marks the Ingredients section "{count} need a
 * match" — and "otherwise ready" is the one publish validator's verdict, so this note can never say "Ready to publish"
 * while Publish would refuse.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Policy — a pure projection of the validator's verdict and the row policy into one sentence, or none
 */
import { validateRecipeForm } from '../form/validate.js';
import type { RecipeFormValues } from '../form/values.js';
import { pluralOf, type EditorMessages } from './messages.js';
import { firstSectionWithErrors } from './sections.js';
import { lineNeedsAttention } from './sectionStatus.js';

/** What the note is derived from. */
export interface PublishNoteInput {
    readonly values: RecipeFormValues;
    /** The text an ingredient entry holds and has not committed (`validateRecipeForm`). */
    readonly pendingEntryText: string;
    /** Whether the recipe is already published: its primary is Save changes, and "Ready to publish" is not true of it. */
    readonly published: boolean;
}

/**
 * The sentence for a recipe that Publish would accept while some lines have no match: "Ready to publish. 2 ingredients
 * have no match, so their nutrition is left out." Pure.
 *
 * @param input - The draft, the uncommitted entry text and whether the recipe is published.
 * @param messages - The editor's copy.
 * @param locale - The active BCP-47 locale, which chooses the plural form.
 * @returns The sentence, or `undefined` when every line is matched, the recipe is not ready, or it is published.
 */
export function publishNoteOf(input: PublishNoteInput, messages: EditorMessages, locale: string): string | undefined {
    if (
        input.published ||
        firstSectionWithErrors(validateRecipeForm(input.values, input.pendingEntryText)) !== undefined
    ) {
        return undefined;
    }

    const unmatched = input.values.ingredients.filter(lineNeedsAttention).length;

    return unmatched === 0 ? undefined : pluralOf(messages.readyUnmatched, unmatched, locale);
}
