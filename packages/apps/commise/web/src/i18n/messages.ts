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
    },
};
