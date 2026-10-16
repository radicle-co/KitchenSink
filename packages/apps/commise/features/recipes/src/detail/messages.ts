/**
 * @module @commise/features-recipes/detail — the copy of a recipe read that failed, shared by both apps. The two
 * dictionaries held the same three sentences word for word; this is their one home. (The loading caption is not here:
 * web says "Loading recipe", mobile "Loading recipe…", and which is right is the apps' copy ruling, not this file's.)
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
}

/** The failed-read copy, per locale. */
export const recipeLoadMessages: LocalizedMessages<RecipeLoadMessages> = {
    en: {
        errorTitle: 'We couldn’t load this recipe.',
        notFoundTitle: 'This recipe isn’t available.',
        retry: 'Try again',
    },
};
