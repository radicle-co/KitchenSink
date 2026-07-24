/**
 * @module @commise/features-recipes/collections/messages — user-facing copy for the collections building
 * blocks (T071–T073).
 *
 * Shared, platform-neutral strings for the collection list, detail, and form, exported once and consumed by
 * BOTH the web `.tsx` and native `.native.tsx` leaves (via `useMessages`), so the platforms cannot drift on
 * copy. The `en` set is required; adding a locale is just another key. Mirrors `../messages.ts`.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the collection-list screen (T071), rendered by both the web and native list views. */
export interface CollectionListMessages {
    /** Page/section heading for the collection list. */
    readonly heading: string;
    /** Label of the create-collection call to action. */
    readonly createCta: string;
    /** Accessible label for the loading state. */
    readonly loadingLabel: string;
    /** Heading of the empty state (a successful load with no collections). */
    readonly emptyTitle: string;
    /** Body copy of the empty state. */
    readonly emptyBody: string;
    /** Message shown when the list fails to load. */
    readonly errorTitle: string;
    /** Label of the retry action in the error state. */
    readonly retry: string;
}

/** Copy for the collection-detail screen (T072), rendered by both the web and native detail views. */
export interface CollectionDetailMessages {
    /** Heading for the member-recipes section. */
    readonly membersHeading: string;
    /** Heading of the empty state (a collection with no member recipes). */
    readonly emptyTitle: string;
    /** Body copy of the empty state. */
    readonly emptyBody: string;
    /** Accessible-label template for a per-row remove control (contains `{title}`). */
    readonly removeRecipe: string;
    /** Label of the add-a-recipe action (opens the recipe picker). */
    readonly addRecipeCta: string;
    /** Label of the rename action. */
    readonly renameCta: string;
    /** Label of the delete action. */
    readonly deleteCta: string;
    /** Error shown when deleting the collection fails (B17). */
    readonly deleteError: string;
    /** Error shown when removing a member recipe fails (B17). */
    readonly removeError: string;
}

/**
 * Copy for the collection recipe-picker (the ADD half of T072), rendered by both the web and native picker
 * views. Templates carry `{name}` (the collection) or `{title}` (a recipe) placeholders.
 */
export interface CollectionRecipePickerMessages {
    /** Heading template naming the collection recipes are added to (contains `{name}`). */
    readonly heading: string;
    /** Accessible label for the search field. */
    readonly searchLabel: string;
    /** Placeholder shown inside the search field. */
    readonly searchPlaceholder: string;
    /** Accessible label for the candidate-loading state. */
    readonly loadingLabel: string;
    /** Message shown when the candidate recipes fail to load. */
    readonly errorTitle: string;
    /** Label of the retry action in the load-error state. */
    readonly retry: string;
    /** Heading of the empty state when the caller owns no recipes at all. */
    readonly emptyTitle: string;
    /** Body copy of the no-recipes empty state. */
    readonly emptyBody: string;
    /** Label of the create-recipe action offered in the no-recipes empty state. */
    readonly createRecipe: string;
    /** Message shown when a search matches none of the caller's recipes (distinct from owning none). */
    readonly noMatchesTitle: string;
    /** Short visible label on a row's add control (the accessible name comes from {@link addRecipe}). */
    readonly add: string;
    /** Accessible-label template for a row's add control (contains `{title}`). */
    readonly addRecipe: string;
    /** Visible marker on a row already in this collection. */
    readonly memberBadge: string;
    /** Accessible-label template for the inert control of a row already in this collection (contains `{title}`). */
    readonly memberControlLabel: string;
    /** Visible label shown on a row whose add is in flight. */
    readonly adding: string;
    /** Polite-announcement template for a successful add (contains `{title}`). */
    readonly addedAnnouncement: string;
    /** Alert shown when an add fails. */
    readonly addFailed: string;
    /** Label of the done action that dismisses the picker. */
    readonly done: string;
}

/** Copy for the collection create/rename form (T073), rendered by both the web and native form views. */
export interface CollectionFormMessages {
    /** Title shown in `create` mode. */
    readonly createTitle: string;
    /** Title shown in `rename` mode. */
    readonly renameTitle: string;
    /** Accessible label for the name field. */
    readonly nameLabel: string;
    /** Placeholder shown inside the name field. */
    readonly namePlaceholder: string;
    /** Submit label in `create` mode. */
    readonly createSubmit: string;
    /** Submit label in `rename` mode. */
    readonly renameSubmit: string;
    /** Label of the cancel action. */
    readonly cancel: string;
}

/** Copy for the collection-header view (W5 Task 6), rendered by both the web and native header leaves. */
export interface CollectionHeaderMessages {
    /** Visibility-badge label when the collection is public. */
    readonly visibilityPublic: string;
    /** Visibility-badge label when the collection is private. */
    readonly visibilityPrivate: string;
    /** Recipe-count label template for exactly one recipe (contains `{count}`). */
    readonly recipeCountOne: string;
    /** Recipe-count label template for any other count (contains `{count}`). */
    readonly recipeCountOther: string;
    /** Source-attribution template for a cloned collection with a resolved source owner handle (contains
     *  `{handle}` and `{name}`). */
    readonly sourceAttribution: string;
    /** Source-attribution template for a cloned collection with no resolved source owner (contains
     *  `{name}`). */
    readonly sourceAttributionNoHandle: string;
    /** Last-pulled template (contains `{date}`). */
    readonly lastPulled: string;
    /** Label of the web back-to-collections affordance (C6). */
    readonly backToCollections: string;
}

/** The shape of the collections feature's shared copy. */
export interface CollectionMessages {
    /** Copy for the collection-list screen. */
    readonly list: CollectionListMessages;
    /** Copy for the collection-detail screen. */
    readonly detail: CollectionDetailMessages;
    /** Copy for the collection recipe-picker (the add-a-recipe flow). */
    readonly picker: CollectionRecipePickerMessages;
    /** Copy for the collection create/rename form. */
    readonly form: CollectionFormMessages;
    /** Copy for the collection-header view (badge, count, source attribution, last-pulled, back). */
    readonly header: CollectionHeaderMessages;
}

export const collectionMessages: LocalizedMessages<CollectionMessages> = {
    en: {
        list: {
            heading: 'Collections',
            createCta: 'New collection',
            loadingLabel: 'Loading collections',
            emptyTitle: 'No collections yet',
            emptyBody: 'Create a collection to organize your recipes.',
            errorTitle: 'We couldn’t load your collections.',
            retry: 'Try again',
        },
        detail: {
            membersHeading: 'Recipes',
            emptyTitle: 'No recipes in this collection yet',
            emptyBody: 'Add recipes to see them here.',
            removeRecipe: 'Remove {title}',
            addRecipeCta: 'Add a recipe',
            renameCta: 'Rename',
            deleteCta: 'Delete',
            deleteError: 'We couldn’t delete this collection. Please try again.',
            removeError: 'We couldn’t remove that recipe. Please try again.',
        },
        picker: {
            heading: 'Add recipes to {name}',
            searchLabel: 'Search your recipes',
            searchPlaceholder: 'Search your recipes',
            loadingLabel: 'Loading your recipes',
            errorTitle: 'We couldn’t load your recipes.',
            retry: 'Try again',
            emptyTitle: 'No recipes yet',
            emptyBody: 'Create a recipe to add it to this collection.',
            createRecipe: 'New recipe',
            noMatchesTitle: 'No recipes match your search',
            add: 'Add',
            addRecipe: 'Add {title}',
            memberBadge: 'In this collection',
            memberControlLabel: '{title} is in this collection',
            adding: 'Adding…',
            addedAnnouncement: 'Added {title}',
            addFailed: 'We couldn’t add that recipe. Please try again.',
            done: 'Done',
        },
        form: {
            createTitle: 'New collection',
            renameTitle: 'Rename collection',
            nameLabel: 'Collection name',
            namePlaceholder: 'e.g. Weeknight dinners',
            createSubmit: 'Create',
            renameSubmit: 'Save',
            cancel: 'Cancel',
        },
        header: {
            visibilityPublic: 'Public',
            visibilityPrivate: 'Private',
            recipeCountOne: '{count} recipe',
            recipeCountOther: '{count} recipes',
            sourceAttribution: 'Source: @{handle}’s "{name}"',
            sourceAttributionNoHandle: 'Source: "{name}"',
            lastPulled: 'Last pulled: {date}',
            backToCollections: 'Back to My Collections',
        },
    },
};
