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
    /** Visible label for the server-paged load-more control (W5/C7). */
    readonly loadMore: string;
    /** Visible label for the load-more control while the next page is loading. */
    readonly loadingMore: string;
    /** Announced beside the load-more control when the next page fails; the loaded collections stay. */
    readonly loadMoreError: string;
    /** The notice when refreshing the collections already on screen fails. */
    readonly refreshError: string;
    /** The result bar's count (contains `{count}`), singular. */
    readonly countOne: string;
    /** The result bar's count (contains `{count}`), plural. */
    readonly countOther: string;
    /** The search field's label (shown from six collections). */
    readonly searchLabel: string;
    /** Clears the search. */
    readonly clearSearch: string;
    /** No collection matches the search (contains `{query}`). */
    readonly noMatch: string;
    /** A card's name: the collection's name and its visibility (contains `{name}` and `{visibility}`). */
    readonly cardLabel: string;
    /** A copy's attribution (contains `{handle}`). */
    readonly copiedFrom: string;
    readonly visibilityPublic: string;
    readonly visibilityPrivate: string;
    /** The first run's line when the cook has no recipes to group yet. */
    readonly needRecipes: string;
    /** The first run's action when the cook has no recipes yet: opens the editor. */
    readonly addRecipe: string;
}

/** Copy for the new-collection sheet (`docs/design/uiOverhaul/buildSpec.md` §5.1). */
export interface CollectionSheetMessages {
    readonly newTitle: string;
    readonly nameLabel: string;
    readonly descriptionLabel: string;
    /** The name's counter (contains `{count}` and `{max}`). */
    readonly counter: string;
    readonly create: string;
    readonly cancel: string;
    readonly close: string;
    readonly nameRequired: string;
    readonly createFailed: string;
    readonly discardTitle: string;
    readonly discardBody: string;
    readonly discard: string;
    readonly keepEditing: string;
}

/** Copy for the sheet's rename mode (`docs/design/uiOverhaul/buildSpec.md` §5.1). */
export interface CollectionRenameMessages {
    readonly title: string;
    /** The primary action (`check`). */
    readonly save: string;
    /** The inline alert when the rename failed; what was typed stays. */
    readonly failed: string;
}

/** Copy for the collection-detail screen (T072), rendered by both the web and native detail views. */
export interface CollectionDetailMessages {
    /** Heading for the member-recipes section. */
    readonly membersHeading: string;
    /** Heading of the empty state (a collection with no member recipes). */
    readonly emptyTitle: string;
    /** Body copy of the empty state. */
    readonly emptyBody: string;
    /** Accessible-label template for a per-row remove control (contains `{title}`). Never rendered as visible text. */
    readonly removeRecipe: string;
    /**
     * The per-row remove control's VISIBLE label — the bare verb. The title lives only in {@link removeRecipe}: a
     * visible label that repeats a long title takes the whole row from the title beside it.
     */
    readonly removeCta: string;
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
    /** A member row's source-indicator state when `addedVia === 'manual'` — owner-added, protected from Pull
     *  Updates (the wireframe's `[x]` state, W5 Task 9 / C3). Rendered as text, never colour alone. */
    readonly sourceIndicatorOwned: string;
    /** A member row's source-indicator state when `addedVia` is `clone_seed`/`pull` — seeded/synced from the
     *  source collection, will refresh on a future Pull Updates (the wireframe's `[ ]` state). */
    readonly sourceIndicatorFromSource: string;
    /** A member row's author-attribution template (contains `{handle}`); rendered only when the member
     *  recipe carries an author handle — omitted rather than showing `by @undefined`. */
    readonly byAuthor: string;
    /** The notice when refreshing the collection already on screen fails. */
    readonly refreshError: string;
    /** Label of the retry action beside {@link refreshError}. */
    readonly refreshRetry: string;
    /** Client-side member-list load-more template naming how many more are hidden (contains `{count}`,
     *  W5/C7 — "Load more (4 more)" in the collection-view wireframe). */
    readonly loadMore: string;
    /** A copy's attribution on the meta line (contains `{handle}`). */
    readonly copiedFrom: string;
    /** A copy's attribution when the source's owner is unknown (contains `{name}`). */
    readonly copiedFromNamed: string;
    /** A copy's attribution when nothing about the source is known. */
    readonly copiedFromUnknown: string;
    /** The meta line's recipe count, singular (contains `{count}`). */
    readonly recipeCountOne: string;
    /** The meta line's recipe count, plural (contains `{count}`). */
    readonly recipeCountOther: string;
    readonly visibilityPublic: string;
    readonly visibilityPrivate: string;
    /** The back link above the title at 840 and wider, and the back control's name elsewhere. */
    readonly backTo: string;
    /** The members' view switch: list. */
    readonly viewList: string;
    /** The members' view switch: grid. */
    readonly viewGrid: string;
    /** The view switch's group name. */
    readonly viewLabel: string;
    /** Not found: the 404 body. */
    readonly notFoundTitle: string;
    readonly notFoundBody: string;
}

/** The collection's ⋯ menu (`docs/design/uiOverhaul/buildSpec.md` §5.2), in the order it is drawn. */
export interface CollectionMenuMessages {
    /** The ⋯ trigger's accessible name (contains `{name}`). */
    readonly moreActions: string;
    /** The native menu sheet's Close control. */
    readonly close: string;
    readonly rename: string;
    readonly makePrivate: string;
    readonly makePublic: string;
    readonly saveCopy: string;
    readonly pullUpdates: string;
    readonly delete: string;
}

/** A member row's ⋯ menu, its removal and the snackbars that follow a change. */
export interface CollectionMemberMessages {
    /** The row's ⋯ trigger name (contains `{title}`). */
    readonly moreActions: string;
    readonly open: string;
    readonly remove: string;
    /** The removal snackbar (contains `{recipe}` and `{collection}`). */
    readonly removed: string;
    readonly undo: string;
    /** The alert when a removal that was already committed failed (contains `{title}`). */
    readonly removeFailed: string;
    /** The visibility snackbar (contains `{visibility}`, which is the lower-case word). */
    readonly visibilityChanged: string;
    readonly visibilityPrivateWord: string;
    readonly visibilityPublicWord: string;
    /** The alert when a visibility change failed. */
    readonly visibilityFailed: string;
    /** The alert when saving a copy of the collection failed. */
    readonly saveCopyFailed: string;
}

/** The confirmation before deleting a collection, and the Premium sheet for making one private. */
export interface CollectionDialogMessages {
    /** Contains `{name}`. */
    readonly deleteTitle: string;
    /** The recipes stay: singular (contains `{count}`). */
    readonly deleteBodyOne: string;
    /** The recipes stay: plural (contains `{count}`). */
    readonly deleteBodyOther: string;
    readonly deleteConfirm: string;
    readonly deleteKeep: string;
    readonly upsellTitle: string;
    readonly upsellBody: string;
    readonly upsellSee: string;
    readonly upsellNotNow: string;
    /** The error under the delete dialog's body when deleting failed. */
    readonly deleteFailed: string;
    /** The delete dialog's busy label. */
    readonly deleting: string;
    /** The Premium sheet's Close control. */
    readonly upsellClose: string;
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
    /** The sheet's title (contains `{name}`). */
    readonly title: string;
    /** The toolbar's label row above the search field. */
    readonly toolbarHeading: string;
    /** The sheet's Close control. */
    readonly close: string;
    /** Polite announcement of a removal (contains `{title}`). */
    readonly removedAnnouncement: string;
    /** The alert when a toggle that added a recipe failed (contains `{title}`). */
    readonly toggleAddFailed: string;
    /** The alert when a toggle that removed a recipe failed (contains `{title}`). */
    readonly toggleRemoveFailed: string;
    /** Done, with what changed (contains `{summary}`). */
    readonly doneWithCount: string;
    /** A part of that summary (contains `{count}`). */
    readonly addedCount: string;
    /** A part of that summary (contains `{count}`). */
    readonly removedCount: string;
    /** Clears the picker's search. */
    readonly clearSearch: string;
    /** The no-recipes state (contains no placeholders). */
    readonly noRecipesTitle: string;
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

/**
 * Copy for the Pull-Updates preview dialog (W5 Task 10, C2 / FR-011): the source attribution, the three-way
 * diff counts, the own-members protection note, and the cancel/count-templated-confirm actions, rendered by
 * both the web and native leaves. Templates carry `{handle}`/`{name}` (source attribution) or `{count}`
 * (the diff counts and the confirm action) placeholders.
 */
export interface PullUpdatesDialogMessages {
    /** Dialog heading. */
    readonly title: string;
    /** Source attribution template with a resolved owner handle (contains `{handle}` and `{name}`). */
    readonly attribution: string;
    /** Source attribution template with no resolved owner handle (contains `{name}`). */
    readonly attributionNoHandle: string;
    /** Accessible label/text of the preview-loading progress affordance. */
    readonly loadingLabel: string;
    /** "N new public recipes will be added" template (contains `{count}`). */
    readonly addedCount: string;
    /** "N recipes removed from source" template (contains `{count}`). */
    readonly removedCount: string;
    /** "N already in this collection (no changes)" template (contains `{count}`). */
    readonly unchangedCount: string;
    /** The "recipes you added directly will not be overwritten" protection note. */
    readonly ownMembersNote: string;
    /** Shown in place of/alongside the confirm action when there is nothing to pull (`added.length === 0`). */
    readonly upToDate: string;
    /** Shown when `error === 'drift'` (409): the source changed since the preview, NOT a dead end — the
     *  caller can Cancel and re-open to re-preview. */
    readonly driftMessage: string;
    /** Shown when `error === 'generic'`: any other preview/commit failure. */
    readonly genericErrorMessage: string;
    /** Label of the cancel action. */
    readonly cancel: string;
    /** "Pull N Recipes" template (contains `{count}`). */
    readonly confirm: string;
}

/** The shape of the collections feature's shared copy. */
export interface CollectionMessages {
    /** Copy for the collection-list screen. */
    readonly list: CollectionListMessages;
    /** Copy for the collection-detail screen. */
    readonly detail: CollectionDetailMessages;
    /** Copy for the collection recipe-picker (the add-a-recipe flow). */
    readonly picker: CollectionRecipePickerMessages;
    /** Copy for the new-collection sheet. */
    readonly sheet: CollectionSheetMessages;
    /** Copy for the sheet's rename mode. */
    readonly rename: CollectionRenameMessages;
    /** Copy for the collection's ⋯ menu. */
    readonly menu: CollectionMenuMessages;
    /** Copy for a member row's ⋯ menu and the snackbars. */
    readonly member: CollectionMemberMessages;
    /** Copy for the delete confirmation and the Premium sheet. */
    readonly dialogs: CollectionDialogMessages;
    /** Copy for the collection-header view (badge, count, source attribution, last-pulled, back). */
    readonly header: CollectionHeaderMessages;
    /** Copy for the Pull-Updates preview dialog (diff counts, protection note, cancel/confirm). */
    readonly pull: PullUpdatesDialogMessages;
}

export const collectionMessages: LocalizedMessages<CollectionMessages> = {
    en: {
        list: {
            heading: 'Collections',
            createCta: 'New collection',
            loadingLabel: 'Loading collections',
            emptyTitle: 'Group recipes your way',
            emptyBody: 'Make a collection for weeknights, holidays or anything else.',
            errorTitle: 'We couldn’t load your collections.',
            retry: 'Try again',
            loadMore: 'Load more',
            loadingMore: 'Loading…',
            loadMoreError: 'We couldn’t load more collections.',
            refreshError: 'We couldn’t refresh your collections.',
            countOne: '{count} collection',
            countOther: '{count} collections',
            searchLabel: 'Search your collections',
            clearSearch: 'Clear search',
            noMatch: 'No collections match “{query}”.',
            cardLabel: '{name}, {visibility}',
            copiedFrom: 'Copied from @{handle}',
            visibilityPublic: 'Public',
            visibilityPrivate: 'Private',
            needRecipes: 'Add a few recipes first.',
            addRecipe: 'Add a recipe',
        },
        sheet: {
            newTitle: 'New collection',
            nameLabel: 'Name',
            descriptionLabel: 'Description (optional)',
            counter: '{count}/{max}',
            create: 'Create collection',
            cancel: 'Cancel',
            close: 'Close',
            nameRequired: 'Give your collection a name.',
            createFailed: 'We couldn’t create the collection. Try again.',
            discardTitle: 'Discard this collection?',
            discardBody: 'The name you typed will be lost.',
            discard: 'Discard',
            keepEditing: 'Keep editing',
        },
        rename: {
            title: 'Rename collection',
            save: 'Save name',
            failed: 'We couldn’t rename the collection. Try again.',
        },
        menu: {
            moreActions: 'More actions for {name}',
            close: 'Close menu',
            rename: 'Rename',
            makePrivate: 'Make private',
            makePublic: 'Make public',
            saveCopy: 'Save a copy',
            pullUpdates: 'Pull updates',
            delete: 'Delete collection',
        },
        member: {
            moreActions: 'More actions for {title}',
            open: 'Open recipe',
            remove: 'Remove from collection',
            removed: 'Removed {recipe} from {collection}.',
            undo: 'Undo',
            removeFailed: 'Couldn’t remove {title}. Try again.',
            visibilityChanged: 'Collection is now {visibility}.',
            visibilityPrivateWord: 'private',
            visibilityPublicWord: 'public',
            visibilityFailed: 'We couldn’t change who can see this collection. Try again.',
            saveCopyFailed: 'We couldn’t save a copy of this collection. Try again.',
        },
        dialogs: {
            deleteTitle: 'Delete {name}?',
            deleteBodyOne: 'The {count} recipe stays in your library.',
            deleteBodyOther: 'The {count} recipes stay in your library.',
            deleteConfirm: 'Delete collection',
            deleteKeep: 'Keep collection',
            upsellTitle: 'Private collections are part of Premium.',
            upsellBody: 'Public collections are free. Premium lets you keep a collection to yourself.',
            upsellSee: 'See Premium',
            upsellNotNow: 'Not now',
            deleteFailed: 'We couldn’t delete this collection. Try again.',
            deleting: 'Deleting…',
            upsellClose: 'Close',
        },
        detail: {
            membersHeading: 'Recipes',
            emptyTitle: 'No recipes here yet',
            emptyBody: 'Add a few recipes to this collection.',
            removeRecipe: 'Remove {title}',
            removeCta: 'Remove',
            addRecipeCta: 'Add recipes',
            renameCta: 'Rename',
            deleteCta: 'Delete',
            deleteError: 'We couldn’t delete this collection. Please try again.',
            removeError: 'We couldn’t remove that recipe. Please try again.',
            sourceIndicatorOwned: 'Added by you',
            sourceIndicatorFromSource: 'From the original collection',
            byAuthor: 'by @{handle}',
            refreshError: 'We couldn’t refresh this collection.',
            refreshRetry: 'Try again',
            loadMore: 'Load more ({count} more)',
            copiedFrom: 'Copied from @{handle}',
            copiedFromNamed: 'Copied from “{name}”',
            copiedFromUnknown: 'Copied from another collection',
            recipeCountOne: '{count} recipe',
            recipeCountOther: '{count} recipes',
            visibilityPublic: 'Public',
            visibilityPrivate: 'Private',
            backTo: 'Back to {parent}',
            viewList: 'List view',
            viewGrid: 'Grid view',
            viewLabel: 'View',
            notFoundTitle: 'We couldn’t find that collection',
            notFoundBody: 'It may have been deleted.',
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
            createRecipe: 'Add a recipe',
            noMatchesTitle: 'No recipes match your search',
            add: 'Add',
            addRecipe: 'Add {title}',
            memberBadge: 'In this collection',
            memberControlLabel: '{title} is in this collection',
            adding: 'Adding…',
            addedAnnouncement: 'Added {title}',
            addFailed: 'We couldn’t add that recipe. Please try again.',
            done: 'Done',
            title: 'Add to {name}',
            toolbarHeading: 'Your recipes',
            close: 'Close',
            removedAnnouncement: 'Removed {title}',
            toggleAddFailed: 'Couldn’t add {title}. Try again.',
            toggleRemoveFailed: 'Couldn’t remove {title}. Try again.',
            doneWithCount: 'Done · {summary}',
            addedCount: '{count} added',
            removedCount: '{count} removed',
            clearSearch: 'Clear search',
            noRecipesTitle: 'You have no recipes yet.',
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
        pull: {
            title: 'Pull Updates from Source Collection',
            attribution: '@{handle} / {name}',
            attributionNoHandle: '{name}',
            loadingLabel: 'Loading pull preview',
            addedCount: '{count} new public recipes will be added',
            removedCount: '{count} recipes removed from source',
            unchangedCount: '{count} already in this collection (no changes)',
            ownMembersNote: 'Recipes you added directly will not be overwritten.',
            upToDate: 'You’re all caught up — there’s nothing new to pull.',
            driftMessage:
                'The source collection changed since you last checked. Cancel and choose Pull Updates again to see the latest changes.',
            genericErrorMessage: 'We couldn’t check for updates. Please try again.',
            cancel: 'Cancel',
            confirm: 'Pull {count} Recipes',
        },
    },
};
