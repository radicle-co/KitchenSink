'use client';

/**
 * @module @commise/features-recipes/collections — the collection list FRAME's session, shared by web's
 * `CollectionListContainer` and mobile's `CollectionsScreen` (`docs/design/uiOverhaul/buildSpec.md` §5.1): the search
 * text, whether the cook has a recipe to group, whether the floating create button yields (the list is loading or settled empty), and the
 * new-collection sheet with its create. The frame sits OUTSIDE the read boundary, so none of this reads the list itself.
 *
 * The collections read is built ONCE here and handed back as `read`, so the key a boundary checks for a server prefetch
 * and the read it gates can never drift apart. The host passes the created collection's id to its own navigation.
 *
 * @pattern Headless hook — the list frame's state; each platform renders it
 */
import { collectionQueries, recipeQueries } from '@kitchensink/recipe-service-client';
import type { CreateCollectionRequest } from '@kitchensink/recipe-service-client';
import { useCreateCollection, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { createEntryYieldsWhileLoading } from '../hooks/libraryState.js';
import { useLibraryState } from '../hooks/useLibraryState.js';
import { useLibraryTotal } from '../hooks/useLibraryTotal.js';
import { COLLECTION_SEARCH_FROM } from './model.js';

/** What {@link useCollectionsList} reads. */
export interface CollectionsListInput {
    /** A collection was created and the sheet is off screen: open it. */
    readonly onCreated: (collectionId: string) => void;
}

/** The list frame's state. */
export interface CollectionsList {
    /** The collections read: the same options object the boundary's prefetch check and the suspense read use. */
    readonly read: ReturnType<ReturnType<typeof collectionQueries>['listInfinite']>;
    readonly search: {
        readonly value: string;
        readonly onChange: (value: string) => void;
        /** Whether the pinned search shows: from {@link COLLECTION_SEARCH_FROM} collections, and while the cook has typed. */
        readonly visible: boolean;
    };
    /** Whether the cook has a recipe to group; while unknown it is `true`, so the first run offers New collection. */
    readonly hasRecipes: boolean;
    /**
     * The floating "New collection" yields (§3.4, §5.1) only while the first read is in flight, so it never appears and
     * then vanishes. On the first run it stays, the same as "New recipe" (designer ruling 2026-11-03), and offline or failed
     * with nothing cached, it shows.
     */
    readonly createEntryYields: boolean;
    /** Focus goes back to the floating button: the sheet closed without creating a collection. */
    readonly createFocus: { readonly requested: boolean; readonly onHandled: () => void };
    readonly sheet: {
        readonly open: boolean;
        readonly onOpenChange: (open: boolean) => void;
        readonly submitting: boolean;
        readonly failed: boolean;
        readonly onOpen: () => void;
        readonly onCreate: (request: CreateCollectionRequest) => void;
        /** The sheet is off screen: open the collection it created, if it created one. */
        readonly onDismissed: () => void;
    };
}

/**
 * The collection list frame's session.
 *
 * @param input - The navigation to the created collection.
 * @returns The read, the search, the first-run facts and the new-collection sheet.
 * @sideEffect Sends the create request; reads the first recipe page to learn whether the cook has any recipe.
 */
export function useCollectionsList({ onCreated }: CollectionsListInput): CollectionsList {
    const client = useRecipeServiceClient();
    const read = collectionQueries(client).listInfinite();
    const [searchValue, setSearchValue] = useState('');
    const [sheetOpen, setSheetOpen] = useState(false);
    // The collection the sheet created, held until the sheet is GONE: native keeps its window up for the slide-out, so
    // navigating from the mutation's success would open the collection over a sheet that is still on screen.
    const [createdId, setCreatedId] = useState<string | undefined>(undefined);
    // The sheet was dismissed with nothing created: focus returns to the button that opened it.
    const [refocusCreate, setRefocusCreate] = useState(false);
    const createCollection = useCreateCollection();
    // One recipe is enough to know; while it is unknown the first run offers New collection, the common case.
    const anyRecipe = useQuery(recipeQueries(client).list({ pageSize: 1 }));
    // A cache-only read of the list's own key (its family is that one key: collection search is on the device and not in
    // it). It fetches nothing.
    const family = [{ queryKey: read.queryKey, exact: true }];
    const createEntryYieldsNow = createEntryYieldsWhileLoading(useLibraryState(family, read.queryKey));
    // The frame sits outside the read's boundary, so it learns how many collections there are from the cache.
    const total = useLibraryTotal(family, read.queryKey);

    return {
        read,
        search: {
            value: searchValue,
            onChange: setSearchValue,
            visible: total >= COLLECTION_SEARCH_FROM || searchValue !== '',
        },
        hasRecipes: (anyRecipe.data?.total ?? 1) > 0,
        createEntryYields: createEntryYieldsNow,
        createFocus: { requested: refocusCreate, onHandled: () => setRefocusCreate(false) },
        sheet: {
            open: sheetOpen,
            onOpenChange: setSheetOpen,
            submitting: createCollection.isPending,
            failed: createCollection.isError,
            onOpen: () => {
                createCollection.reset();
                setCreatedId(undefined);
                setSheetOpen(true);
            },
            onCreate: (request) =>
                createCollection.mutate(request, {
                    onSuccess: (created) => {
                        setCreatedId(created.id);
                        setSheetOpen(false);
                    },
                }),
            onDismissed: () => {
                if (createdId === undefined) {
                    setRefocusCreate(true);

                    return;
                }

                setCreatedId(undefined);
                onCreated(createdId);
            },
        },
    };
}
