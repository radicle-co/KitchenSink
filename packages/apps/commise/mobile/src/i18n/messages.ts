/**
 * Mobile-app-specific user-facing copy (strings that live only in the mobile app). Shared, cross-platform
 * copy lives in the feature packages' `messages.ts`. A {@link LocalizedMessages} dictionary resolved per
 * active locale via `useMessages` from `@commise/i18n/react`. The `en` set is required.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** The shape of the mobile app's own copy. */
export interface MobileMessages {
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
        /** Alert shown when deleting a recipe fails. */
        readonly deleteError: string;
        /** Alert shown when cloning a recipe fails. */
        readonly cloneError: string;
        /** Accessible label shown while the version history is loading. */
        readonly versionsLoading: string;
        /** Message shown when the version history fails to load. */
        readonly versionsError: string;
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
        /** Create-a-freeform-ingredient action template (contains `{query}`). */
        readonly create: string;
        /** Busy label shown while a freeform ingredient is being created. */
        readonly creating: string;
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
    };
}

export const mobileMessages: LocalizedMessages<MobileMessages> = {
    en: {
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
            deleteError: 'We couldn’t delete this recipe. Please try again.',
            cloneError: 'We couldn’t clone this recipe. Please try again.',
            versionsLoading: 'Loading version history…',
            versionsError: 'We couldn’t load the version history.',
        },
        ingredientPicker: {
            heading: 'Add an ingredient',
            searchLabel: 'Search ingredients',
            searchPlaceholder: 'e.g. olive oil',
            empty: 'No matching ingredients. Create a new one below.',
            create: 'Create “{query}”',
            creating: 'Adding…',
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
        },
    },
};
