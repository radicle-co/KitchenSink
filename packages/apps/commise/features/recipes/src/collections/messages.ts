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
    /** Label of the rename action. */
    readonly renameCta: string;
    /** Label of the delete action. */
    readonly deleteCta: string;
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

/** The shape of the collections feature's shared copy. */
export interface CollectionMessages {
    /** Copy for the collection-list screen. */
    readonly list: CollectionListMessages;
    /** Copy for the collection-detail screen. */
    readonly detail: CollectionDetailMessages;
    /** Copy for the collection create/rename form. */
    readonly form: CollectionFormMessages;
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
            renameCta: 'Rename',
            deleteCta: 'Delete',
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
    },
};
