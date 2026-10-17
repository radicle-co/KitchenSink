/**
 * Web-app-specific user-facing copy (strings that live only in the web app — the shell chrome, page titles, route
 * boundaries). Copy that web and mobile say identically lives in the feature packages' `messages.ts`
 * (`@commise/features-core/home`'s `homeMessages`, `@commise/features-recipes`'s recipe, collection and version sets), and
 * `packages/tools/repoGuards/__tests__/appCopyIsNotDuplicated.test.ts` fails when a sentence is authored in both apps' own
 * dictionaries. A {@link LocalizedMessages} dictionary resolved per request by `getDictionary` (server) / `useMessages`
 * (client). The `en` set is required; adding a locale is another key.
 */
import type { HomeChromeMessages } from '@commise/features-core/home';
import type { LocalizedMessages } from '@commise/i18n';

import type { ShellSurfaceId } from '@/components/app/shellSurfaces';

/** A route's document metadata: the browser tab's title and the description a shared link shows. */
export interface PageMetadataMessages {
    readonly title: string;
    readonly description: string;
}

/** The shape of the web app's own copy. */
export interface WebMessages {
    /**
     * Copy for the shared App Router resilience boundaries (B18) — the `error.tsx` / `loading.tsx` /
     * `not-found.tsx` files under `[locale]` and each data segment render this ONE localized set through
     * `RouteErrorBoundary` / `LoadingNotice` / `RouteNotFoundState`, so a segment never invents its own copy.
     */
    readonly boundary: {
        /**
         * Copy only the last-resort `global-error.tsx` owns. Its title, body and retry label are the shared
         * `boundaryMessages` (`@commise/features-core/boundary/messages`, which imports no design system); the
         * Home link is a full page load rather than the notice's in-app navigation, so its label stays here.
         */
        readonly error: {
            /** Label of the last-resort page's full page load of Home. */
            readonly home: string;
        };
        /** Copy for a route segment's `loading.tsx` (the Suspense fallback shown while it streams in). */
        readonly loading: {
            /** The loading notice's caption (the root boundary cannot know what it is loading, so it is the one bare label). */
            readonly label: string;
        };
        /** Copy for a route segment's `not-found.tsx`. */
        readonly notFound: {
            /** Heading of the not-found state. */
            readonly title: string;
            /** Supporting body copy. */
            readonly description: string;
            /** Label of the link back to the current locale's Home. */
            readonly backHome: string;
        };
    };
    readonly home: {
        /** The site's document title (the root layout's metadata). */
        readonly title: string;
        /** The site's description (the root layout's metadata). */
        readonly tagline: string;
        /**
         * Copy for the web-only Home chrome (sidebar, top bar) — US-000 / FR-046. The labels both tab bars draw are
         * `homeMessages.chrome`; the page titles are keyed by the closed {@link ShellSurfaceId} union, so a surface added
         * without copy is a compile error rather than a blank bar.
         */
        readonly chrome: {
            /** The product wordmark beside the logo in the sidebar. */
            readonly wordmark: string;
            /** Accessible name of the logo/wordmark. */
            readonly logoAlt: string;
            /** Accessible name of the primary (sidebar) navigation landmark. The tab bar's is `homeMessages.chrome.tabNavLabel`. */
            readonly primaryNavLabel: string;
            /**
             * Title shown in the sticky top bar, one per shell-hosted SURFACE. This replaced a single `pageTitle` that was
             * hard-coded 'Home' on all 15 shell routes.
             *
             * Deliberately NOT shared with `destinations` (nav labels) or with a page's own `<h1>` copy: the three slots
             * happen to read alike on some routes today, but they change for different reasons (a nav label may shorten to
             * fit a collapsed rail; a page heading may carry context a 56px bar cannot), so they are separate knowledge,
             * not duplication.
             */
            readonly pageTitles: Readonly<Record<ShellSurfaceId, string>>;
            /** The sidebar's collapse control: its visible label and, expanded, its name. */
            readonly collapseNav: string;
            /** The collapsed sidebar's expand control's name (the glyph alone shows). */
            readonly expandNav: string;
            /** Web's "Back to top" on a long list (§3.6). */
            readonly backToTop: string;
        };
    };
    /**
     * Copy owned by the web photo-uploader container: the accessible names of the two hidden file inputs it
     * supplies. Every sentence the cook reads (upload, remove, size, type, cap) is `photoMessages` in
     * `@commise/features-recipes`, shared with mobile.
     */
    readonly recipes: {
        readonly photos: {
            /** Accessible label of the add-photo file-input control the container supplies to the block. */
            readonly addLabel: string;
            /** Accessible label of the hidden single-select input that picks a photo's replacement (U6). */
            readonly replaceInputLabel: string;
        };
    };
    /**
     * A route's document metadata, read by its `generateMetadata`: the browser tab's title, and the description a
     * search result or a shared link shows.
     */
    readonly pageMetadata: {
        readonly dataSources: PageMetadataMessages;
        readonly profile: PageMetadataMessages;
        readonly signIn: PageMetadataMessages;
        readonly signUp: PageMetadataMessages;
    };
}

/** The whole shell chrome copy the web sidebar and top bar draw: the shared navigation labels plus the web-only ones. */
export type WebChromeMessages = HomeChromeMessages & WebMessages['home']['chrome'];

export const webMessages: LocalizedMessages<WebMessages> = {
    en: {
        boundary: {
            error: {
                home: 'Go to Home',
            },
            loading: {
                label: 'Loading…',
            },
            notFound: {
                title: 'We couldn’t find that page.',
                description: 'It may have been moved or no longer exists.',
                backHome: 'Back to Home',
            },
        },
        home: {
            title: 'Commise',
            tagline: 'Your personal AI-powered recipe assistant.',
            chrome: {
                wordmark: 'Commise',
                logoAlt: 'Commise',
                primaryNavLabel: 'Main',
                pageTitles: {
                    home: 'Home',
                    recipes: 'Recipes',
                    recipeNew: 'New recipe',
                    recipeDetail: 'Recipe',
                    recipeEdit: 'Edit recipe',
                    recipeVersions: 'Version history',
                    discover: 'Discover',
                    collections: 'Collections',
                    collectionDetail: 'Collection',
                    profile: 'Profile',
                    dataSources: 'Data sources',
                    notFound: 'Page not found',
                },
                collapseNav: 'Collapse',
                expandNav: 'Expand sidebar',
                backToTop: 'Back to top',
            },
        },
        recipes: {
            photos: {
                addLabel: 'Add photo',
                replaceInputLabel: 'Choose a replacement photo',
            },
        },
        pageMetadata: {
            dataSources: {
                title: 'Data sources · Commise',
                description: 'The food databases behind the nutrition figures, and their licenses',
            },
            profile: { title: 'Profile · Commise', description: 'Your user profile' },
            signIn: { title: 'Sign in · Commise', description: 'Sign in to your Commise account' },
            signUp: {
                title: 'Create your account · Commise',
                description: 'Create a Commise account to keep your recipes in one place',
            },
        },
    },
};
