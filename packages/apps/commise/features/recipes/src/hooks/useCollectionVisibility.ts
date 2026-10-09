/**
 * @module @commise/features-recipes/hooks — changing a collection's visibility from its ⋯ menu
 * (`docs/design/uiOverhaul/buildSpec.md` §5.2; blueprint Part C, slice 5).
 *
 * The change happens at once: the cached collection is rewritten before the server answers, a snackbar says so, and
 * Undo is a COMPENSATING `setVisibility` — safe because visibility carries no provenance, unlike a removed member. Both
 * calls share one `scope` per collection, so Undo is sent after the change it undoes. A cook without the premium plan
 * who chooses private gets the Premium sheet instead and nothing is sent; one who made a private collection public gets
 * no Undo, because the way back would be refused (`./collections/visibilityUndo.ts`). A refused change rolls back to
 * what it replaced.
 *
 * @pattern Command — the change and its compensating change
 * @pattern Policy — `visibilityChangeNeedsPremium` and `canUndoVisibilityChange` decide the sheet and the Undo
 */
import { useMessages } from '@commise/i18n/react';
import { useSnackbar } from '@commise/ui/snackbar';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import {
    invalidateCollections,
    recipeServiceKeys,
    useRecipeServiceClient,
} from '@kitchensink/recipe-service-client/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { collectionMessages } from '../collections/messages.js';
import { canUndoVisibilityChange, visibilityChangeNeedsPremium } from '../collections/visibilityUndo.js';
import { fillTemplate } from '../list/model.js';

/** What one change asks for: where the collection is going and where it was. */
interface VisibilityChange {
    readonly to: RecipeVisibility;
    readonly from: RecipeVisibility;
}

/** What the detail screen gets. */
export interface CollectionVisibilityControl {
    /** Ask for a visibility. A no-op for the one the collection already has. */
    readonly change: (to: RecipeVisibility) => void;
    /** The Premium sheet is open: the cook chose private without the plan. */
    readonly upsellOpen: boolean;
    readonly closeUpsell: () => void;
    /** The last change was refused and rolled back. */
    readonly failed: boolean;
}

/**
 * Visibility changes for one collection.
 *
 * @param collection - The collection, and whether the viewer may make things private.
 * @returns The press, and the Premium sheet's state.
 * @sideEffect Rewrites the collection's cached detail, sends update requests and shows a snackbar.
 */
export function useCollectionVisibility(collection: {
    readonly id: string;
    readonly canGoPrivate: boolean;
}): CollectionVisibilityControl {
    const { member: copy } = useMessages(collectionMessages);
    const snackbar = useSnackbar();
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();
    const [upsellOpen, setUpsellOpen] = useState(false);
    const detailKey = recipeServiceKeys.collection(collection.id);
    const mutationKey = ['recipe-service', 'mutations', 'collectionVisibility', collection.id] as const;

    const writeVisibility = (visibility: RecipeVisibility): void => {
        queryClient.setQueryData<CollectionWithRecipes>(detailKey, (detail) =>
            detail === undefined ? undefined : { ...detail, visibility },
        );
    };

    const mutation = useMutation({
        mutationKey,
        scope: { id: `collection:${collection.id}` },
        mutationFn: ({ to }: VisibilityChange) => client.updateCollection(collection.id, { visibility: to }),
        onMutate: async ({ to }) => {
            await queryClient.cancelQueries({ queryKey: detailKey });
            writeVisibility(to);
        },
        onError: (_error, { from }) => writeVisibility(from),
        onSettled: () => {
            if (queryClient.isMutating({ mutationKey }) === 1) {
                invalidateCollections(queryClient);
            }
        },
    });

    return {
        upsellOpen,
        closeUpsell: () => setUpsellOpen(false),
        failed: mutation.isError,
        change: (to) => {
            const from = queryClient.getQueryData<CollectionWithRecipes>(detailKey)?.visibility;

            if (from === undefined || from === to) {
                return;
            }

            if (visibilityChangeNeedsPremium(to, collection.canGoPrivate)) {
                setUpsellOpen(true);

                return;
            }

            mutation.reset();
            mutation.mutate({ to, from });
            snackbar.show({
                message: fillTemplate(copy.visibilityChanged, {
                    visibility:
                        to === RecipeVisibility.PRIVATE ? copy.visibilityPrivateWord : copy.visibilityPublicWord,
                }),
                ...(canUndoVisibilityChange({ from, canGoPrivate: collection.canGoPrivate })
                    ? { action: { label: copy.undo, onAction: () => mutation.mutate({ to: from, from: to }) } }
                    : {}),
            });
        },
    };
}
