/**
 * @module @commise/features-core/boundary — the copy of the crash fallback both apps show, in one dictionary.
 *
 * Every string is the same on both platforms. The body used to be app-supplied ("this page" on web, "this screen, or go
 * back to Home" on mobile); the UX review ruled the split away — the person who hit a crash does not distinguish a page
 * from a screen, the Back to Home button already says the second clause, and "snag" was the one error voice in either
 * app that did not say "couldn’t load". The Home variant stays separate because Home offers no Back to Home.
 *
 * The title ends with a full stop, as every sibling error title in both apps' dictionaries does ("We couldn’t load this
 * recipe."); mobile's used to be the only one without.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the crash fallback. */
export interface BoundaryMessages {
    /** What happened: a screen or segment threw while rendering. */
    readonly errorTitle: string;
    /** The body under the title, for any crashed view but Home. Never echoes the raw error to the viewer. */
    readonly errorBody: string;
    /** The body when Home itself crashed (it names Home, and offers no Back to Home). */
    readonly errorBodyHome: string;
    /** Re-render the crashed view and refetch what failed. */
    readonly retry: string;
    /** Leave a crashed view for Home. */
    readonly backToHome: string;
}

/** The crash fallback's copy, per locale. */
export const boundaryMessages: LocalizedMessages<BoundaryMessages> = {
    en: {
        errorTitle: 'Something went wrong.',
        errorBody: 'We couldn’t load this. Please try again.',
        errorBodyHome: 'We couldn’t load Home. Please try again.',
        retry: 'Try again',
        backToHome: 'Back to Home',
    },
};
