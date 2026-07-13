/**
 * Web-app-specific user-facing copy (strings that live only in the web app — home shell, nav). Shared,
 * cross-platform copy lives in the feature packages' `messages.ts` (e.g. `@commise/features-recipes`).
 * A {@link LocalizedMessages} dictionary resolved per request by `getDictionary` (server) / `useMessages`
 * (client). The `en` set is required; adding a locale is another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** The shape of the web app's own copy. */
export interface WebMessages {
    readonly home: {
        readonly title: string;
        readonly tagline: string;
        readonly welcome: string;
        readonly nav: {
            readonly label: string;
            readonly profile: string;
            readonly settings: string;
            readonly account: string;
        };
    };
    /**
     * Web-only recipe copy — the fetch-state affordances the detail route owns (the shared list/detail
     * building blocks localize their own content via `@commise/features-recipes`).
     */
    readonly recipes: {
        readonly detail: {
            /** Accessible label for the detail loading state. */
            readonly loadingLabel: string;
            /** Message shown when the recipe fails to load. */
            readonly errorTitle: string;
            /** Message shown when the requested recipe does not exist (or is not the caller's). */
            readonly notFoundTitle: string;
            /** Label of the retry action in the error state. */
            readonly retry: string;
        };
    };
}

export const webMessages: LocalizedMessages<WebMessages> = {
    en: {
        home: {
            title: 'Commise',
            tagline: 'Your personal AI-powered recipe assistant.',
            welcome: 'Welcome to Commise',
            nav: {
                label: 'Account',
                profile: 'Profile',
                settings: 'Settings',
                account: 'Account',
            },
        },
        recipes: {
            detail: {
                loadingLabel: 'Loading recipe',
                errorTitle: 'We couldn’t load this recipe.',
                notFoundTitle: 'We couldn’t find that recipe.',
                retry: 'Try again',
            },
        },
    },
};
