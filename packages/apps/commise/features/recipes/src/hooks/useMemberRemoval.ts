/**
 * @module @commise/features-recipes/hooks — removing a recipe from a collection's detail, with Undo
 * (`docs/architecture/uiOverhaulBlueprint.md` A15; `docs/design/uiOverhaul/buildSpec.md` §5.2).
 *
 * Undo CANCELS BEFORE SENDING. Removing hides the row at once and shows a snackbar; the removal request is sent only
 * when the snackbar COMMITS — it timed out, a newer snackbar replaced it, or the cook left the screen (the host and its
 * timer outlive the screen). Undo just shows the row again. It never re-adds after the fact: a member carries
 * provenance ("Added by you" / "From the original collection"), and a re-add would plausibly come back as "Added by
 * you" (inferred, not verified server-side).
 *
 * The commit lives in the hook's own mutation options, not in a per-call callback: TanStack skips per-call callbacks once
 * the component is gone, and the commit must still run (and the collection must still refresh) then. The hidden ids are
 * view state, not a cache write; they are dropped when the collection has refreshed past them, or when the removal fails,
 * which brings the row back with an alert.
 *
 * @pattern Command — the removal, delayed by the snackbar's commit
 * @pattern Memento — the hidden ids are the one thing Undo restores
 */
import { useMessages } from '@commise/i18n/react';
import { useSnackbar } from '@commise/ui/snackbar';
import { recipeServiceKeys, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { collectionMessages } from '../collections/messages.js';

/** The recipe being removed. */
export interface RemovableMember {
    readonly id: string;
    readonly title: string;
}

/** What the detail screen gets. */
export interface MemberRemoval {
    /** Recipes whose removal is pending or just committed: the list leaves them out. */
    readonly hiddenIds: readonly string[];
    /** The title of a recipe whose committed removal failed, until the next removal. */
    readonly failedTitle: string | undefined;
    /** Hide the row and offer Undo. */
    readonly remove: (member: RemovableMember) => void;
}

/**
 * Removal with Undo for one collection's members.
 *
 * @param collection - The collection being viewed.
 * @returns The hidden ids, the failure and the press.
 * @sideEffect Shows a snackbar, and sends a removal request when the snackbar commits.
 */
export function useMemberRemoval(collection: { readonly id: string; readonly name: string }): MemberRemoval {
    const { member: copy } = useMessages(collectionMessages);
    const snackbar = useSnackbar();
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();
    const [hiddenIds, setHiddenIds] = useState<readonly string[]>([]);
    const [failedTitle, setFailedTitle] = useState<string | undefined>(undefined);

    const show = (recipeId: string): void => setHiddenIds((ids) => (ids.includes(recipeId) ? ids : [...ids, recipeId]));
    const unhide = (recipeId: string): void => setHiddenIds((ids) => ids.filter((id) => id !== recipeId));

    const commit = useMutation({
        mutationKey: ['recipe-service', 'mutations', 'memberRemoval', collection.id],
        mutationFn: ({ id }: RemovableMember) => client.removeRecipeFromCollection(collection.id, id),
        onSuccess: (_result, { id }) => {
            // The row stays hidden until the refreshed collection no longer holds it, so it cannot flash back.
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections }).then(() => unhide(id));
        },
        onError: (_error, { id, title }) => {
            unhide(id);
            setFailedTitle(title);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collection(collection.id) });
        },
    });

    return {
        hiddenIds,
        failedTitle,
        remove: (member) => {
            setFailedTitle(undefined);
            show(member.id);
            snackbar.show({
                message: fillTemplate(copy.removed, { recipe: member.title, collection: collection.name }),
                action: { label: copy.undo, onAction: () => unhide(member.id) },
                onTimeout: () => commit.mutate(member),
            });
        },
    };
}
