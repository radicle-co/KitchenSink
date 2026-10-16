'use client';

/**
 * @module @commise/features-recipes/collections — the SETTLED collection detail's session, shared by web's
 * `CollectionDetailContainer` and mobile's `CollectionDetailScreen` (`docs/design/uiOverhaul/buildSpec.md` §5.2, §5.3).
 *
 * It owns the work around one collection that has already been read: the removal, visibility and pull hooks, the three
 * mutations (rename, delete, Save a copy), which sheet is open, the add-recipes picker's search and its "members when it
 * opened", the list/grid layout and the deferred calorie lookup. The host passes the collection IN: this package does
 * not depend on `@commise/query`, so the read boundary and the failed-refresh notice (`useRefreshNotice`) stay with the
 * app, which reads them from the same query. Navigation arrives as a {@link CollectionDetailNav} port, so a route push
 * and a navigator callback are the same call here.
 *
 * ⛔ Two orderings are decided ONCE, for both apps:
 * - DELETE closes the confirm dialog, and only then leaves. The dialog is a window of its own on native; popping the
 *   screen that hosts it while it is open crashes Android (`addViewAt ... already has a parent`). Web used to navigate
 *   from the mutation's `onSuccess` with the dialog still mounted.
 * - "Add a recipe" from the empty picker closes the picker, and only then opens the editor, for the same reason.
 * Both go through {@link useLeaveWhenClosed}, which fires once per request however often the host re-renders.
 *
 * @pattern Headless hook — the container/screen session of one settled collection; each platform renders it
 * @pattern Port — {@link CollectionDetailNav}, the navigation the session asks the app to perform
 */
import type { PaidFeatureState } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import type { ContainerClass } from '@commise/ui/container-class';
import type { CollectionWithRecipes, CreateCollectionRequest } from '@kitchensink/recipe-service-client';
import { useCloneCollection, useDeleteCollection, useUpdateCollection } from '@kitchensink/recipe-service-client/hooks';
import { useMemo, useState } from 'react';

import { offersPrivate } from '../actions/privateGate.js';
import { cardVariantOf, type CardVariant, type ListViewMode } from '../card/cardVariant.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { useCollectionPull, type CollectionPull } from '../hooks/useCollectionPull.js';
import { useCollectionVisibility, type CollectionVisibilityControl } from '../hooks/useCollectionVisibility.js';
import { useMemberRemoval, type MemberRemoval } from '../hooks/useMemberRemoval.js';
import { usePickerAnnouncement } from '../hooks/usePickerAnnouncement.js';
import { useRecipeNutritionBatches, type RecipeNutritionLookup } from '../hooks/useRecipeNutritionBatches.js';
import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import { viewModeOf } from '../list/viewModePreference.js';
import type { RefreshNoticeControl } from '../refresh/model.js';
import { collectionMessages } from './messages.js';
import { doneSummaryOf, type PickerSummary } from './pickerModel.js';
import { useLeaveWhenClosed } from './useLeaveWhenClosed.js';

/** The navigation the session asks of the app. */
export interface CollectionDetailNav {
    /** The collection was deleted and its confirm dialog has closed: leave the screen. Called once. */
    readonly onDeleted: () => void;
    /** Save a copy succeeded: open the copy. */
    readonly onCloned: (collectionId: string) => void;
    /** The empty picker asked for a recipe and has closed: open the editor. Called once per request. */
    readonly onCreateRecipe: () => void;
}

/** What {@link useCollectionDetail} reads. */
export interface CollectionDetailInput {
    /** The collection with its members, already read (the app's suspense read). */
    readonly collection: CollectionWithRecipes;
    /** The failed-refresh notice the app's `useRefreshNotice` made from the same read. */
    readonly refreshNotice: RefreshNoticeControl | undefined;
    /** The viewer's paid-feature state, from the app's profile read: decides whether the menu offers Private. */
    readonly paidFeatures: PaidFeatureState;
    /** The cook's stored list/grid choice, or `undefined` until it is known. */
    readonly viewChoice: ListViewMode | undefined;
    /** Remember a list/grid choice (the web cookie, the native store). */
    readonly onViewChoice: (mode: ListViewMode) => void;
    readonly nav: CollectionDetailNav;
}

/** The picker's announcement for its polite live region, with the words already filled. */
interface PickerAnnouncementText {
    readonly text: string;
    readonly occurrence: number;
}

/** Everything the detail renders from. */
export interface CollectionDetail {
    readonly collection: CollectionWithRecipes;
    readonly refreshNotice: RefreshNoticeControl | undefined;
    /** The members the cook sees: a member whose removal is pending (its Undo is on screen) is left out. */
    readonly members: CollectionWithRecipes['recipes'];
    readonly layout: {
        readonly container: ContainerClass;
        readonly viewMode: ListViewMode;
        readonly variant: CardVariant;
        readonly onViewModeChange: (mode: ListViewMode) => void;
    };
    /** The deferred calorie lookup over EVERY member (one page). */
    readonly nutritionFor: RecipeNutritionLookup;
    readonly removal: MemberRemoval;
    readonly visibility: CollectionVisibilityControl;
    /** Present only when the viewer's menu offers the visibility item. */
    readonly onToggleVisibility: (() => void) | undefined;
    readonly pull: CollectionPull;
    readonly rename: {
        readonly open: boolean;
        readonly onOpenChange: (open: boolean) => void;
        readonly submitting: boolean;
        readonly failed: boolean;
        readonly onStart: () => void;
        readonly onSubmit: (request: CreateCollectionRequest) => void;
    };
    readonly deletion: {
        readonly open: boolean;
        readonly busy: boolean;
        readonly failed: boolean;
        readonly onStart: () => void;
        readonly onKeep: () => void;
        readonly onConfirm: () => void;
    };
    readonly saveCopy: { readonly failed: boolean; readonly onSave: () => void };
    readonly picker: {
        readonly open: boolean;
        readonly query: string;
        readonly onQueryChange: (query: string) => void;
        readonly onClearSearch: () => void;
        readonly summary: PickerSummary;
        readonly announcement: PickerAnnouncementText | undefined;
        readonly onOpen: () => void;
        readonly onClose: () => void;
        readonly onCreateRecipe: () => void;
    };
}

/**
 * The settled collection detail's session.
 *
 * @param input - The collection, the viewer's paid-feature state, the stored view choice and the navigation port.
 * @returns The view-model both platforms render.
 * @sideEffect Sends the rename, delete, Save a copy, visibility, removal and pull requests; calls `nav` from an effect.
 */
export function useCollectionDetail({
    collection,
    refreshNotice,
    paidFeatures,
    viewChoice,
    onViewChoice,
    nav,
}: CollectionDetailInput): CollectionDetail {
    const { id } = collection;
    const { picker: pickerCopy } = useMessages(collectionMessages);
    const deleteCollection = useDeleteCollection();
    const updateCollection = useUpdateCollection();
    const cloneCollection = useCloneCollection();
    const pull = useCollectionPull(id);
    const visibility = useCollectionVisibility({ id, paidFeatures });
    const removal = useMemberRemoval({ id, name: collection.name });
    const announcement = usePickerAnnouncement(id);

    const container = useMainContainerClass();
    const viewMode = viewModeOf(viewChoice, container);
    const variant = cardVariantOf(container, viewMode, 'library');

    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState('');
    // The members when the picker opened: Done's "2 added, 1 removed" is the difference from this, not a count of presses.
    const [membersAtOpen, setMembersAtOpen] = useState<readonly string[]>([]);
    const [creatingRecipe, setCreatingRecipe] = useState(false);

    const memberIds = useMemo(() => collection.recipes.map((recipe) => recipe.id), [collection.recipes]);
    const members = useMemo(
        () => collection.recipes.filter((recipe) => !removal.hiddenIds.includes(recipe.id)),
        [collection.recipes, removal.hiddenIds],
    );
    // The deferred calorie lookup (ADR-0021 §6), fed from EVERY member, not the revealed window: the window grows on tap,
    // and batching it would re-batch on every "load more" and blink the figures already on screen back to skeletons. The
    // library surface never draws the compact card (`cardVariantOf`), so every card here can read its promise.
    const nutritionFor = useRecipeNutritionBatches([memberIds]);

    useLeaveWhenClosed(deleteCollection.isSuccess, deleteOpen, nav.onDeleted);
    useLeaveWhenClosed(creatingRecipe, pickerOpen, nav.onCreateRecipe);

    return {
        collection,
        refreshNotice,
        members,
        layout: { container, viewMode, variant, onViewModeChange: onViewChoice },
        nutritionFor,
        removal,
        visibility,
        onToggleVisibility: offersPrivate(paidFeatures, collection.visibility)
            ? () => visibility.change(collection.visibility === 'public' ? 'private' : 'public')
            : undefined,
        pull,
        rename: {
            open: renameOpen,
            onOpenChange: setRenameOpen,
            submitting: updateCollection.isPending,
            failed: updateCollection.isError,
            onStart: () => {
                updateCollection.reset();
                setRenameOpen(true);
            },
            onSubmit: (request) => updateCollection.mutate({ id, request }, { onSuccess: () => setRenameOpen(false) }),
        },
        deletion: {
            open: deleteOpen,
            busy: deleteCollection.isPending,
            failed: deleteCollection.isError,
            onStart: () => {
                deleteCollection.reset();
                setDeleteOpen(true);
            },
            onKeep: () => setDeleteOpen(false),
            onConfirm: () => deleteCollection.mutate(id, { onSuccess: () => setDeleteOpen(false) }),
        },
        saveCopy: {
            failed: cloneCollection.isError,
            onSave: () => cloneCollection.mutate({ id }, { onSuccess: (created) => nav.onCloned(created.id) }),
        },
        picker: {
            open: pickerOpen,
            query: pickerQuery,
            onQueryChange: setPickerQuery,
            onClearSearch: () => setPickerQuery(''),
            summary: doneSummaryOf(membersAtOpen, memberIds),
            announcement:
                announcement === undefined
                    ? undefined
                    : {
                          text: fillTemplate(
                              announcement.member ? pickerCopy.addedAnnouncement : pickerCopy.removedAnnouncement,
                              { title: announcement.title },
                          ),
                          occurrence: announcement.at,
                      },
            onOpen: () => {
                setMembersAtOpen(memberIds);
                setPickerQuery('');
                setCreatingRecipe(false);
                setPickerOpen(true);
            },
            onClose: () => setPickerOpen(false),
            onCreateRecipe: () => {
                setCreatingRecipe(true);
                setPickerOpen(false);
            },
        },
    };
}
