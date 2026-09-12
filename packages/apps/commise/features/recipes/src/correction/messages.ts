/**
 * @module @commise/features-recipes/correction/messages — user-facing copy for the ingredient-correction
 * affordance (plan U14 / R19, R20).
 *
 * Platform-neutral strings consumed by BOTH the web and native `IngredientPicker` leaves via `useMessages`,
 * so the two platforms cannot drift on what they tell a cook their correction did. Mirrors the shape of the
 * feature's sibling message sets; the `en` set is required and adding a locale is another key.
 *
 * ⛔ THE TWO "SAVED" SENTENCES ARE DELIBERATELY DIFFERENT, and merging them would be a correctness bug rather
 * than a copy simplification. A correction either binds a phrase for the person who made it or for EVERY user
 * of the installation, and which one happened is decided server-side from grants the client cannot read. One
 * sentence for both would tell a curator they had made a private note when they had rewritten what that
 * phrase means for everyone.
 *
 * ⚠️ "Already saved" is a NEUTRAL fact, not a failure. Re-asserting a binding already in force writes nothing
 * — the wire calls that `recorded: false` and it is a success — so this string must never be phrased as an
 * error, or correcting the same phrase twice would look like a fault.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the "teach the resolver" control and every outcome it can produce. */
export interface RecipeCorrectionMessages {
    /**
     * The control's label. Contains `{phrase}` — the text the cook actually typed — because a bare
     * "Remember this" gives no clue WHAT is being remembered when several suggestions are on screen.
     */
    readonly teachAction: string;
    /** Names the group the control belongs to, for assistive technology. */
    readonly regionLabel: string;
    /** Announced while the correction is being written. */
    readonly saving: string;
    /** The correction bound the phrase for its author alone. */
    readonly savedForYou: string;
    /** ⛔ The correction bound the phrase for EVERY user — a materially different consequence. */
    readonly savedForEveryone: string;
    /** Nothing was written because the binding already in force says exactly this. NOT an error. */
    readonly alreadySaved: string;
    /** The write itself failed. The only string that may be rendered with an error tone. */
    readonly failed: string;
}

/** The ingredient-correction copy. */
export const recipeCorrectionMessages: LocalizedMessages<RecipeCorrectionMessages> = {
    en: {
        teachAction: 'Always use this for “{phrase}”',
        regionLabel: 'Correct this ingredient match',
        saving: 'Saving your correction…',
        savedForYou: 'Saved. We’ll use this match for you from now on.',
        savedForEveryone: 'Saved for everyone. This phrase now means this ingredient for all cooks.',
        alreadySaved: 'Already saved — nothing to change.',
        failed: 'We couldn’t save that correction. Your ingredient was still added.',
    },
};
