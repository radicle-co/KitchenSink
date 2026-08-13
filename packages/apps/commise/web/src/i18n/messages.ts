/**
 * Web-app-specific user-facing copy (strings that live only in the web app — home shell, nav). Shared,
 * cross-platform copy lives in the feature packages' `messages.ts` (e.g. `@commise/features-recipes`).
 * A {@link LocalizedMessages} dictionary resolved per request by `getDictionary` (server) / `useMessages`
 * (client). The `en` set is required; adding a locale is another key.
 */
import type { GreetingBucket, HomeNavItemId, RoadmapWidgetId } from '@commise/features-core';
import type { LocalizedMessages } from '@commise/i18n';

import type { ShellSurfaceId } from '@/components/app/shellSurfaces';

/** The shape of the web app's own copy. */
export interface WebMessages {
    /**
     * Copy for the shared App Router resilience boundaries (B18) — the `error.tsx` / `loading.tsx` /
     * `not-found.tsx` files under `[locale]` and each data segment render this ONE localized set through
     * `RouteErrorState` / `RouteLoadingState` / `RouteNotFoundState`, so a segment never invents its own copy.
     */
    readonly boundary: {
        /** Copy for a route segment's `error.tsx` — a render throw Next caught, never silent (DA9-reported). */
        readonly error: {
            /** Heading of the error state. */
            readonly title: string;
            /** Supporting body copy. Deliberately generic — never echoes the raw error message to the viewer. */
            readonly description: string;
            /** Label of the retry action, wired to Next's `reset()`. */
            readonly retry: string;
        };
        /** Copy for a route segment's `loading.tsx` (the Suspense fallback shown while it streams in). */
        readonly loading: {
            /** Accessible label of the loading status region. */
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
        readonly title: string;
        readonly tagline: string;
        readonly welcome: string;
        readonly nav: {
            readonly label: string;
            readonly recipes: string;
            readonly profile: string;
            readonly settings: string;
            readonly account: string;
        };
        /**
         * Copy for the Home chrome (sidebar, top bar, mobile tab bar) — US-000 / FR-046. Keyed by the SHARED
         * models in `@commise/features-core`, so a destination or roadmap widget added there without copy is
         * a compile error rather than a blank label discovered in review.
         */
        readonly chrome: {
            /** The product wordmark beside the logo in the sidebar. */
            readonly wordmark: string;
            /** Accessible name of the logo/wordmark. */
            readonly logoAlt: string;
            /** Accessible name of the primary (sidebar) navigation landmark. */
            readonly primaryNavLabel: string;
            /** Accessible name of the mobile tab-bar navigation landmark. */
            readonly tabNavLabel: string;
            /**
             * Title shown in the sticky top bar, one per shell-hosted SURFACE — keyed by the closed
             * {@link ShellSurfaceId} union, so a surface added without copy is a compile error rather than a
             * blank bar. This replaced a single `pageTitle` that was hard-coded 'Home' on all 15 shell routes.
             *
             * Deliberately NOT shared with `destinations` (nav labels) or with a page's own `<h1>` copy:
             * the three slots happen to read alike on some routes today, but they change for different reasons
             * (a nav label may shorten to fit a collapsed rail; a page heading may carry context a 56px bar
             * cannot), so they are separate knowledge, not duplication.
             */
            readonly pageTitles: Readonly<Record<ShellSurfaceId, string>>;
            /** Accessible name of the control that opens navigation on small screens. */
            readonly openNav: string;
            /** Accessible name of the control that closes navigation on small screens. */
            readonly closeNav: string;
            /** Accessible name of the sidebar collapse control. */
            readonly collapseNav: string;
            /** Accessible name of the sidebar expand control (when collapsed). */
            readonly expandNav: string;
            /** Accessible name of the search entry point. */
            readonly search: string;
            /** Accessible name of the notifications control. */
            readonly notifications: string;
            /** Accessible name of the avatar / account entry point. */
            readonly account: string;
            /** Fallback avatar name when the viewer has no display name yet. */
            readonly accountNoName: string;
            /** Suffix appended to an unreachable destination's accessible name (never a dead link). */
            readonly comingSoonSuffix: string;
            /** Label of each navigation destination, keyed by the shared nav model's id. */
            readonly destinations: Readonly<Record<HomeNavItemId, string>>;
        };
        /** Greeting copy, one per time-of-day bucket. Keyed by the shared {@link GreetingBucket} union. */
        readonly greetings: Readonly<Record<GreetingBucket, string>>;
        /**
         * Copy for the roadmap skeleton placeholders (FR-046 / R6 as amended by CR-001). Titles are the REAL
         * widget headings from the mockup — the placeholder shows what is coming, never invented data.
         */
        readonly roadmap: {
            /** Visible badge on every placeholder. Visible (not sr-only) so it reads the same to everyone. */
            readonly comingSoon: string;
            /** The real heading of each roadmap widget, keyed by the shared roadmap registry's id. */
            readonly titles: Readonly<Record<RoadmapWidgetId, string>>;
        };
        /**
         * Copy owned by the Home widget-surface host (US-000 / FR-046): the greeting header and the
         * accessible name of the widget-surface region. The widgets localize their own content via their
         * feature packages; these are the host-chrome strings.
         */
        readonly surface: {
            /** Accessible name of the widget-surface region (`role="region"`). */
            readonly regionLabel: string;
            /** Accessible label + text of the recipe widget's "see all" entry point into the recipes surface. */
            readonly seeAllRecipes: string;
            /** Fallback shown when a live Home widget throws (B23) — replaces the silent `null`. */
            readonly widgetError: string;
        };
        /**
         * Copy for the once-per-session subscription upgrade nudge shown when a free-tier viewer taps a
         * premium-gated entry point on Home (FR-046). The mechanism is host-owned; in v1 no live widget is
         * premium-gated, so it ships ready for the first gated widget (005–009).
         */
        readonly nudge: {
            /** Nudge heading. */
            readonly title: string;
            /** Nudge body copy. */
            readonly body: string;
            /** Label of the primary upgrade action. */
            readonly upgrade: string;
            /** Label of the dismiss action. */
            readonly dismiss: string;
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
            /** Label of the in-app back control on the detail header, back to the recipe list (C1). */
            readonly backAction: string;
            /** Label of the owner-only link to the recipe editor (W2/D1 — restores the web detail entry point). */
            readonly editAction: string;
            /** Label of the owner-only link to the recipe's version history (W2/D1). */
            readonly versionHistory: string;
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
            /** Shown on the create wizard's Photos step (a new recipe has no id yet to attach photos to). */
            readonly photosAfterCreateNotice: string;
        };
        /** Copy for the ingredient typeahead the shared form block deliberately omits (the container owns it). */
        readonly picker: {
            /** Accessible label for the picker region. */
            readonly regionLabel: string;
            /** Accessible label for the search input. */
            readonly searchLabel: string;
            /** Placeholder inside the search input. */
            readonly searchPlaceholder: string;
            /** Badge next to the search box naming the ingredient database it searches (C5, wireframe
             *  recipe-edit.md:56 "[USDA database]"). */
            readonly usdaBadge: string;
            /** Accessible label for the in-flight search indicator. */
            readonly searching: string;
            /** Empty-state copy shown when a search returns no matches. */
            readonly noMatches: string;
            /** Heading of the "your own previously-used ingredients" section of the blended typeahead (Stage 2). */
            readonly ownSectionTitle: string;
            /** Heading of the food-catalog (USDA-seeded golden records) section of the blended typeahead. */
            readonly catalogSectionTitle: string;
            /** Provenance badge on a food-catalog row (it is not yet one of the caller's ingredients). */
            readonly catalogBadge: string;
            /** Non-blocking notice shown when the food catalog is unreachable and only local matches rendered (F2). */
            readonly catalogUnavailable: string;
            /** Accessible label for the in-flight indicator while a picked catalog row is being added. */
            readonly addingFromCatalog: string;
            /** Message shown when adding a picked food-catalog row fails. */
            readonly catalogAddError: string;
            /** Message shown when the ingredient search fails. */
            readonly errorTitle: string;
            /** Primary "find nutrition" action for a typed name not in the results (addByName; contains `{query}`). */
            readonly addByName: string;
            /** Accessible label for the in-flight addByName (food-resolution) indicator. */
            readonly addingByName: string;
            /** Message shown when adding a food by name fails. */
            readonly addByNameError: string;
            /** Accessible label for the in-flight freeform-create indicator. */
            readonly creating: string;
            /** Message shown when creating a freeform ingredient fails. */
            readonly createError: string;
            /** Add-as-freeform (fallback) action template (contains `{query}`). */
            readonly addFreeform: string;
            /** Notice shown for a match whose food resolution is terminal (no nutrition match; FR-007). */
            readonly terminalNotice: string;
            /** Heading for the disambiguation panel of an `UNRESOLVED` match (contains `{name}`). */
            readonly disambiguateTitle: string;
            /** Accessible label for the in-flight candidate-loading indicator. */
            readonly disambiguateLoading: string;
            /** Message shown when loading disambiguation candidates fails. */
            readonly disambiguateError: string;
            /** Copy shown when an `UNRESOLVED` match has no candidates to choose from. */
            readonly disambiguateEmpty: string;
            /** Label of the action that leaves the disambiguation panel and returns to search. */
            readonly disambiguateBack: string;
            /** Accessible label for the in-flight resolve indicator. */
            readonly resolving: string;
            /** Message shown when resolving the picked candidate fails. */
            readonly resolveError: string;
        };
        /**
         * Copy owned by the photo-uploader container (T067). The shared `RecipePhotoManager` block localizes
         * its own grid/remove/empty/cap copy; these are the app-owned strings — the accessible label of the
         * caller-supplied add-photo control, the error shown when the presign → PUT → confirm upload fails,
         * and the two client-side pre-validation rejections (REQ-011/REQ-012) run before a file ever reaches
         * that upload.
         */
        readonly photos: {
            /** Accessible label of the add-photo file-input control the container supplies to the block. */
            readonly addLabel: string;
            /** Error shown when uploading a photo (presign, direct PUT, or confirm) fails. */
            readonly uploadError: string;
            /** Error shown when a picked file's size exceeds the 5 MB limit (REQ-011), before upload starts. */
            readonly tooLargeError: string;
            /** Error shown when a picked file's type is outside the allowlist (REQ-012), before upload starts. */
            readonly unsupportedTypeError: string;
            /** Accessible label of the hidden single-select input that picks a photo's replacement (U6). */
            readonly replaceInputLabel: string;
            /** Error shown when Replace is pressed at the photo cap — a lossless swap needs a free slot (U6). */
            readonly replaceAtCapError: string;
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
        boundary: {
            error: {
                title: 'Something went wrong.',
                description: 'We couldn’t load this page. Please try again.',
                retry: 'Try again',
            },
            loading: {
                label: 'Loading',
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
            welcome: 'Welcome to Commise',
            nav: {
                label: 'Account',
                recipes: 'Recipes',
                profile: 'Profile',
                settings: 'Settings',
                account: 'Account',
            },
            chrome: {
                wordmark: 'Commise',
                logoAlt: 'Commise',
                primaryNavLabel: 'Main',
                tabNavLabel: 'Main',
                pageTitles: {
                    home: 'Home',
                    recipes: 'Recipes',
                    recipeNew: 'New recipe',
                    recipeDetail: 'Recipe',
                    recipeEdit: 'Edit recipe',
                    recipeVersions: 'Version history',
                    discover: 'Discover',
                    collections: 'Collections',
                    collectionNew: 'New collection',
                    collectionDetail: 'Collection',
                    collectionAddRecipes: 'Add recipes',
                    collectionRename: 'Rename collection',
                    profile: 'Profile',
                    account: 'Account',
                    settings: 'Settings',
                },
                openNav: 'Open navigation',
                closeNav: 'Close navigation',
                collapseNav: 'Collapse navigation',
                expandNav: 'Expand navigation',
                search: 'Search',
                notifications: 'Notifications',
                account: 'Account',
                accountNoName: 'Your account',
                comingSoonSuffix: 'coming soon',
                destinations: {
                    home: 'Home',
                    recipes: 'Recipes',
                    'meal-plan': 'Meal Plan',
                    grocery: 'Grocery',
                    nutrition: 'Nutrition',
                    profile: 'Profile',
                },
            },
            greetings: {
                morning: 'Good morning, Chef!',
                afternoon: 'Good afternoon, Chef!',
                evening: 'Good evening, Chef!',
                night: 'Still up, Chef?',
            },
            roadmap: {
                comingSoon: 'Coming soon',
                titles: {
                    nutrition: "Today's Nutrition",
                    'resume-cooking': 'Resume cooking',
                    'meal-plan': "This Week's Meals",
                },
            },
            surface: {
                regionLabel: 'Home',
                seeAllRecipes: 'See all recipes',
                widgetError: 'This section couldn’t load.',
            },
            nudge: {
                title: 'Unlock Commise Pro',
                body: 'Upgrade to Commise Pro to use this feature.',
                upgrade: 'See plans',
                dismiss: 'Maybe later',
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
                backAction: 'Back',
                editAction: 'Edit recipe',
                versionHistory: 'Version history',
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
                photosAfterCreateNotice: 'Save this recipe first — you can add photos from its edit page.',
            },
            picker: {
                regionLabel: 'Ingredient search',
                searchLabel: 'Search ingredients',
                searchPlaceholder: 'Search for an ingredient',
                usdaBadge: 'USDA database',
                searching: 'Searching ingredients',
                noMatches: 'No matching ingredients found.',
                ownSectionTitle: 'Your ingredients',
                catalogSectionTitle: 'Food catalog',
                catalogBadge: 'USDA',
                catalogUnavailable: 'Showing your ingredients only — the food catalog is unavailable right now.',
                addingFromCatalog: 'Adding from the food catalog',
                catalogAddError: 'We couldn’t add that food. Try again, or add it as a custom ingredient.',
                errorTitle: 'We couldn’t search ingredients.',
                addByName: 'Find nutrition for “{query}”',
                addingByName: 'Finding nutrition',
                addByNameError: 'We couldn’t add that ingredient. You can add it as a custom ingredient instead.',
                creating: 'Adding ingredient',
                createError: 'We couldn’t add that ingredient.',
                addFreeform: 'Add “{query}” as a custom ingredient',
                terminalNotice: 'No nutrition match — add it as a custom ingredient or remove it.',
                disambiguateTitle: 'Which “{name}” did you mean?',
                disambiguateLoading: 'Loading options',
                disambiguateError: 'We couldn’t load options for that ingredient.',
                disambiguateEmpty: 'No options to choose from — add it as a custom ingredient instead.',
                disambiguateBack: 'Back to search',
                resolving: 'Resolving ingredient',
                resolveError: 'We couldn’t resolve that ingredient.',
            },
            photos: {
                addLabel: 'Add photo',
                uploadError: 'We couldn’t upload that photo. Please try again.',
                tooLargeError: 'That photo is larger than 5 MB. Choose a smaller file.',
                unsupportedTypeError: 'That file type isn’t supported. Use a JPEG, PNG, or WebP photo.',
                replaceInputLabel: 'Choose a replacement photo',
                replaceAtCapError: 'Remove a photo first — replacing needs room for the new one.',
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
