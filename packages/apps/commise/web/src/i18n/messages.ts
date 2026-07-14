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
        /**
         * Web-only copy for the owner/viewer action controls composed onto the detail route (T068/T074/T075).
         * The shared building blocks localize their own copy; these are the app-owned strings — the delete
         * trigger that opens the shared dialog, and the premium gate reason for the visibility toggle.
         */
        readonly actions: {
            /** Label of the owner-only control that opens the delete-confirmation dialog. */
            readonly deleteAction: string;
            /** Reason shown when the private visibility option is gated off (no premium signal available). */
            readonly premiumRequired: string;
        };
        /**
         * Web-only fetch-state affordances the version-history route owns. The shared `RecipeVersionList`
         * building block localizes its own list/empty content via `@commise/features-recipes`; the
         * loading + error states around the fetch belong to the app.
         */
        readonly versions: {
            /** Accessible label for the version-history loading state. */
            readonly loadingLabel: string;
            /** Message shown when the version history fails to load. */
            readonly errorTitle: string;
            /** Label of the retry action in the error state. */
            readonly retry: string;
        };
        /** Copy owned by the create/edit containers (the shared form block localizes its own field copy). */
        readonly form: {
            /** Error shown when persisting a create/edit fails. */
            readonly submitError: string;
        };
        /** Copy for the ingredient typeahead the shared form block deliberately omits (the container owns it). */
        readonly picker: {
            /** Accessible label for the picker region. */
            readonly regionLabel: string;
            /** Accessible label for the search input. */
            readonly searchLabel: string;
            /** Placeholder inside the search input. */
            readonly searchPlaceholder: string;
            /** Accessible label for the in-flight search indicator. */
            readonly searching: string;
            /** Empty-state copy shown when a search returns no matches. */
            readonly noMatches: string;
            /** Message shown when the ingredient search fails. */
            readonly errorTitle: string;
            /** Accessible label for the in-flight freeform-create indicator. */
            readonly creating: string;
            /** Message shown when creating a freeform ingredient fails. */
            readonly createError: string;
            /** Add-as-freeform action template (contains `{query}`). */
            readonly addFreeform: string;
            /** Notice shown for a match whose food resolution is terminal (no nutrition match; FR-007). */
            readonly terminalNotice: string;
        };
    };
    /**
     * Web-only collection copy — the fetch-state affordances the detail/form routes own (the shared
     * collection building blocks localize their own content via `@commise/features-recipes`).
     */
    readonly collections: {
        readonly detail: {
            /** Accessible label for the detail loading state. */
            readonly loadingLabel: string;
            /** Message shown when the collection fails to load. */
            readonly errorTitle: string;
            /** Message shown when the requested collection does not exist (or is not the caller's). */
            readonly notFoundTitle: string;
            /** Label of the retry action in the error state. */
            readonly retry: string;
        };
        readonly form: {
            /** Accessible label for the rename form's seed-loading state. */
            readonly loadingLabel: string;
            /** Validation message shown when the name is empty. */
            readonly nameRequired: string;
            /** Message shown when a create/rename submission fails. */
            readonly submitError: string;
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
            actions: {
                deleteAction: 'Delete recipe',
                premiumRequired: 'Upgrade to premium to make a recipe private.',
            },
            versions: {
                loadingLabel: 'Loading version history',
                errorTitle: 'We couldn’t load the version history.',
                retry: 'Try again',
            },
            form: {
                submitError: 'We couldn’t save this recipe. Please try again.',
            },
            picker: {
                regionLabel: 'Ingredient search',
                searchLabel: 'Search ingredients',
                searchPlaceholder: 'Search for an ingredient',
                searching: 'Searching ingredients',
                noMatches: 'No matching ingredients found.',
                errorTitle: 'We couldn’t search ingredients.',
                creating: 'Adding ingredient',
                createError: 'We couldn’t add that ingredient.',
                addFreeform: 'Add “{query}” as a custom ingredient',
                terminalNotice: 'No nutrition match — add it as a custom ingredient or remove it.',
            },
        },
        collections: {
            detail: {
                loadingLabel: 'Loading collection',
                errorTitle: 'We couldn’t load this collection.',
                notFoundTitle: 'We couldn’t find that collection.',
                retry: 'Try again',
            },
            form: {
                loadingLabel: 'Loading collection',
                nameRequired: 'Enter a name for your collection.',
                submitError: 'We couldn’t save your collection. Please try again.',
            },
        },
    },
};
