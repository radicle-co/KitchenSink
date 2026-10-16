/**
 * @module @commise/features-recipes/detail — the copy of a recipe read that failed, shared by both apps. The two
 * dictionaries held the same three sentences word for word; this is their one home. The loading caption is here too:
 * web said "Loading recipe" and mobile "Loading recipe…"; the single ellipsis character is the house form for a loading
 * caption (`evaluateFinal.md`: three dots are not an ellipsis), so both say "Loading recipe…".
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for a recipe read that failed. */
export interface RecipeLoadMessages {
    /** The read failed for any reason but a 404. */
    readonly errorTitle: string;
    /** The recipe is gone, or the cook may not see it. A 404 is final: there is no retry beside it. */
    readonly notFoundTitle: string;
    /** Read again. */
    readonly retry: string;
    /** What the recipe read's loading state is called, on both apps. */
    readonly loadingLabel: string;
}

/** The failed-read copy, per locale. */
export const recipeLoadMessages: LocalizedMessages<RecipeLoadMessages> = {
    en: {
        errorTitle: 'We couldn’t load this recipe.',
        notFoundTitle: 'This recipe isn’t available.',
        retry: 'Try again',
        loadingLabel: 'Loading recipe…',
    },
};
