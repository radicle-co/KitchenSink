/**
 * Mobile-app-specific user-facing copy (strings that live only in the mobile app). Shared, cross-platform
 * copy lives in the feature packages' `messages.ts`. A {@link LocalizedMessages} dictionary resolved per
 * active locale via `useMessages` from `@commise/i18n/react`. The `en` set is required.
 */
import type { GreetingBucket, HomeNavItemId, RoadmapWidgetId } from '@commise/features-core';
import type { LocalizedMessages } from '@commise/i18n';

/** The shape of the mobile app's own copy. */
export interface MobileMessages {
    readonly home: {
        /**
         * Time-of-day greeting copy, one per bucket. Keyed by the shared {@link GreetingBucket} union so web
         * and mobile greet identically (FR-044); a missing bucket is a compile error, not a blank header.
         */
        readonly greetings: Readonly<Record<GreetingBucket, string>>;
        /** Accessible label for the Home widget-surface region (the scrollable widget list). */
        readonly regionLabel: string;
        /** Label of the recipe widget's entry point into the full recipes surface. */
        readonly seeAllRecipes: string;
        /**
         * Copy for the Home chrome (top bar + bottom tab bar) — US-000 / FR-046. Keyed by the SHARED nav
         * model in `@commise/features-core`, so a destination added there without copy is a compile error.
         */
        readonly chrome: {
            /** Title shown in the top bar on the Home route. */
            readonly pageTitle: string;
            /** Accessible name of the search entry point. */
            readonly search: string;
            /** Accessible name of the notifications control. */
            readonly notifications: string;
            /** Accessible name of the avatar / account entry point. */
            readonly account: string;
            /** Fallback avatar accessible name when the viewer has no display name yet. */
            readonly accountNoName: string;
            /** Accessible name of the bottom tab-bar navigation landmark. */
            readonly tabNavLabel: string;
            /** Suffix appended to an unreachable destination's accessible name (never a dead tab). */
            readonly comingSoonSuffix: string;
            /** Label of each navigation destination, keyed by the shared nav model's id. */
            readonly destinations: Readonly<Record<HomeNavItemId, string>>;
        };
        /**
         * Copy for the roadmap skeleton placeholders (FR-046 / R6 as amended by CR-001). Titles are the REAL
         * widget headings from the mockup — the placeholder shows what is coming, never invented data.
         */
        readonly roadmap: {
            /** Visible "coming soon" badge on every placeholder. */
            readonly comingSoon: string;
            /** The real heading of each roadmap widget, keyed by the shared roadmap registry's id. */
            readonly titles: Readonly<Record<RoadmapWidgetId, string>>;
        };
        /** Copy for the once-per-session subscription upgrade nudge (shown when a free-tier viewer taps a
         * premium-gated widget entry point). No live v1 widget is gated, so it ships ready for 005–009. */
        readonly nudge: {
            /** The nudge dialog's heading (also its accessible label). */
            readonly title: string;
            /** The nudge's supporting body copy. */
            readonly body: string;
            /** The primary upgrade action (dismisses in v1; the subscription surface is owned by 010). */
            readonly upgrade: string;
            /** The dismiss action. */
            readonly dismiss: string;
        };
    };
    readonly profile: {
        readonly displayName: string;
        readonly avatarUrl: string;
        readonly save: string;
        readonly saving: string;
        readonly loadError: string;
    };
    readonly suspension: {
        readonly title: string;
        readonly message: string;
    };
    readonly recipes: {
        /** Accessible label shown while a single recipe's detail is loading. */
        readonly detailLoading: string;
        /** Message shown when a recipe's detail fails to load. */
        readonly detailError: string;
        /** Label of the back affordance on the recipe-detail screen. */
        readonly back: string;
        /** Label of the owner action that opens the recipe editor. */
        readonly editAction: string;
        /** Label of the owner action that opens the delete-confirmation dialog. */
        readonly deleteAction: string;
        /** Label of the owner action that opens the version-history screen. */
        readonly versionsAction: string;
        /** Reason shown when the private-visibility option is gated behind a premium plan (C-004). */
        readonly visibilityUpgradeReason: string;
        /** Alert shown when creating a recipe fails. */
        readonly createError: string;
        /** Alert shown when saving recipe edits fails. */
        readonly saveError: string;
        /** Shown on the create wizard's Photos step (a new recipe has no id yet to attach photos to). */
        readonly photosAfterCreateNotice: string;
        /** Alert shown when deleting a recipe fails. */
        readonly deleteError: string;
        /** Alert shown when cloning a recipe fails. */
        readonly cloneError: string;
        /** Accessible label shown while the version history is loading. */
        readonly versionsLoading: string;
        /** Message shown when the version history fails to load. */
        readonly versionsError: string;
    };
    readonly recipePhotos: {
        /** Visible + accessible label of the control that opens the native image picker. */
        readonly addLabel: string;
        /** Alert shown when acquiring, uploading, or confirming a photo fails. */
        readonly uploadError: string;
        /** Alert shown when removing a photo fails. */
        readonly removeError: string;
        /** Alert shown when a picked asset's size exceeds the 5 MB limit (REQ-011), before upload starts. */
        readonly tooLargeError: string;
        /** Alert shown when a picked asset's type is outside the allowlist (REQ-012), before upload starts. */
        readonly unsupportedTypeError: string;
    };
    readonly ingredientPicker: {
        /** Section heading for the ingredient typeahead. */
        readonly heading: string;
        /** Accessible label for the ingredient search field. */
        readonly searchLabel: string;
        /** Placeholder shown inside the ingredient search field. */
        readonly searchPlaceholder: string;
        /** Empty-state copy shown when a search returns no catalog matches. */
        readonly empty: string;
        /** Primary "find nutrition" action for a typed name (addByName, the async-resolution entry point; contains `{query}`). */
        readonly addByName: string;
        /** Busy label shown while a food is being added by name (food-resolution in flight). */
        readonly addingByName: string;
        /** Message shown when adding a food by name fails. */
        readonly addByNameError: string;
        /** Create-a-freeform-ingredient (fallback) action template (contains `{query}`). */
        readonly create: string;
        /** Busy label shown while a freeform ingredient is being created. */
        readonly creating: string;
        /** Heading for the disambiguation panel of an `UNRESOLVED` match (contains `{name}`). */
        readonly disambiguateTitle: string;
        /** Busy label shown while disambiguation candidates load. */
        readonly disambiguateLoading: string;
        /** Message shown when loading disambiguation candidates fails. */
        readonly disambiguateError: string;
        /** Copy shown when an `UNRESOLVED` match has no candidates to choose from. */
        readonly disambiguateEmpty: string;
        /** Label of the action that leaves the disambiguation panel and returns to search. */
        readonly disambiguateBack: string;
        /** Busy label shown while the picked candidate resolves. */
        readonly resolving: string;
        /** Message shown when resolving the picked candidate fails. */
        readonly resolveError: string;
    };
    readonly collections: {
        /** Accessible label shown while a single collection is loading. */
        readonly detailLoading: string;
        /** Message shown when a collection fails to load. */
        readonly detailError: string;
        /** Label of the back affordance on the collection-detail screen. */
        readonly back: string;
        /** Alert shown when saving a collection (create or rename) fails. */
        readonly saveError: string;
    };
    readonly recipesNav: {
        /** Tab label for the caller's own recipes (the list). */
        readonly myRecipes: string;
        /** Tab label for public-recipe discovery. */
        readonly discover: string;
        /** Tab label for the caller's collections. */
        readonly collections: string;
    };
    readonly common: {
        readonly somethingWentWrong: string;
        /** Body copy for the root-level crash fallback (B18) — the app-wide safety net around `AppRoot`. */
        readonly rootErrorBody: string;
        /** Label of the retry affordance on the root-level crash fallback. */
        readonly retry: string;
    };
}

export const mobileMessages: LocalizedMessages<MobileMessages> = {
    en: {
        home: {
            greetings: {
                morning: 'Good morning, Chef!',
                afternoon: 'Good afternoon, Chef!',
                evening: 'Good evening, Chef!',
                night: 'Still up, Chef?',
            },
            regionLabel: 'Home',
            seeAllRecipes: 'See all recipes',
            chrome: {
                pageTitle: 'Home',
                search: 'Search',
                notifications: 'Notifications',
                account: 'Account',
                accountNoName: 'Your account',
                tabNavLabel: 'Main',
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
            roadmap: {
                comingSoon: 'Coming soon',
                titles: {
                    nutrition: "Today's Nutrition",
                    'resume-cooking': 'Resume cooking',
                    'meal-plan': "This Week's Meals",
                },
            },
            nudge: {
                title: 'Unlock Commise Pro',
                body: 'Upgrade to Commise Pro to use this feature.',
                upgrade: 'See plans',
                dismiss: 'Maybe later',
            },
        },
        profile: {
            displayName: 'Display name',
            avatarUrl: 'Avatar URL',
            save: 'Save',
            saving: 'Saving…',
            loadError: 'Failed to load profile.',
        },
        suspension: {
            title: 'Account Suspended',
            message:
                'Your account is suspended. Commise access is paused until support restores your account. ' +
                'Please contact support if you believe this is a mistake.',
        },
        recipes: {
            detailLoading: 'Loading recipe…',
            detailError: 'We couldn’t load this recipe.',
            back: 'Back',
            editAction: 'Edit recipe',
            deleteAction: 'Delete recipe',
            versionsAction: 'Version history',
            visibilityUpgradeReason: 'Upgrade to premium to make a recipe private.',
            createError: 'We couldn’t create your recipe. Please try again.',
            saveError: 'We couldn’t save your changes. Please try again.',
            photosAfterCreateNotice: 'Save this recipe first — you can add photos from its edit screen.',
            deleteError: 'We couldn’t delete this recipe. Please try again.',
            cloneError: 'We couldn’t clone this recipe. Please try again.',
            versionsLoading: 'Loading version history…',
            versionsError: 'We couldn’t load the version history.',
        },
        recipePhotos: {
            addLabel: 'Add photo',
            uploadError: 'We couldn’t add your photo. Please try again.',
            removeError: 'We couldn’t remove this photo. Please try again.',
            tooLargeError: 'That photo is larger than 5 MB. Choose a smaller file.',
            unsupportedTypeError: 'That file type isn’t supported. Use a JPEG, PNG, or WebP photo.',
        },
        ingredientPicker: {
            heading: 'Add an ingredient',
            searchLabel: 'Search ingredients',
            searchPlaceholder: 'e.g. olive oil',
            empty: 'No matching ingredients. Create a new one below.',
            addByName: 'Find nutrition for “{query}”',
            addingByName: 'Finding nutrition…',
            addByNameError: 'We couldn’t add that ingredient. Create a custom one below instead.',
            create: 'Create “{query}”',
            creating: 'Adding…',
            disambiguateTitle: 'Which “{name}” did you mean?',
            disambiguateLoading: 'Loading options…',
            disambiguateError: 'We couldn’t load options for that ingredient.',
            disambiguateEmpty: 'No options to choose from — create a custom one below.',
            disambiguateBack: 'Back to search',
            resolving: 'Resolving…',
            resolveError: 'We couldn’t resolve that ingredient.',
        },
        collections: {
            detailLoading: 'Loading collection…',
            detailError: 'We couldn’t load this collection.',
            back: 'Back',
            saveError: 'We couldn’t save this collection. Please try again.',
        },
        recipesNav: {
            myRecipes: 'My recipes',
            discover: 'Discover',
            collections: 'Collections',
        },
        common: {
            somethingWentWrong: 'Something went wrong',
            rootErrorBody: 'We hit a snag loading this screen. Please try again.',
            retry: 'Try again',
        },
    },
};
