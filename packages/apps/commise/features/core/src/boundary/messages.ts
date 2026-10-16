/**
 * @module @commise/features-core/boundary — the copy of the crash fallback both apps show, in one dictionary.
 *
 * The title and the two action labels are the same sentence on both platforms by definition. The BODY is not here: a web
 * segment says "this page" and a mobile screen says "this screen, or back to Home", and the app that knows which it is
 * supplies it.
 *
 * The title ends with a full stop, as every sibling error title in both apps' dictionaries does ("We couldn’t load this
 * recipe."); mobile's used to be the only one without.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the crash fallback. */
export interface BoundaryMessages {
    /** What happened: a screen or segment threw while rendering. */
    readonly errorTitle: string;
    /** Re-render the crashed view and refetch what failed. */
    readonly retry: string;
    /** Leave a crashed view for Home. */
    readonly backToHome: string;
}

/** The crash fallback's copy, per locale. */
export const boundaryMessages: LocalizedMessages<BoundaryMessages> = {
    en: {
        errorTitle: 'Something went wrong.',
        retry: 'Try again',
        backToHome: 'Back to Home',
    },
};
