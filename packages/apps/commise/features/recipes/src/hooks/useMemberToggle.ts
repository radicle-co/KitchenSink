/**
 * @module @commise/features-recipes/hooks — one row of the add-recipes picker (`docs/architecture/uiOverhaulBlueprint.md`
 * A15; `docs/design/uiOverhaul/buildSpec.md` §5.3).
 *
 * Each toggle is its own TanStack mutation: Command + optimistic update + reconciliation.
 *
 * - `onMutate` cancels the collection's in-flight read and flips the row's membership in the cached detail, so the
 *   control changes at once. (A queued mutation's `onMutate` runs when it is made, not when it reaches the front of
 *   its queue.)
 * - Mutations are SERIALIZED PER PAIR with a `scope`, so a fast on → off → on reaches the server in that order. Rows
 *   are not serialized with each other: two recipes may be in flight together.
 * - `onError` applies the INVERSE of this one toggle. It does not restore a snapshot, because a snapshot taken before
 *   this toggle would wipe another row's flip that landed since.
 * - The cache is reconciled with the server only when the LAST toggle for the collection has settled
 *   (`isMutating(...) === 1`: the settling mutation still counts itself), so a refetch cannot overwrite a flip that is
 *   still in flight.
 *
 * It is not routed through the outbox: there is no `removeMember` intent kind, and adding one is a persisted-format
 * change (ADR-0057's open items). Offline gives the ordinary error and the row flips back.
 *
 * @pattern Command — each toggle is a mutation; its variables name the recipe and the direction
 * @pattern Observer — `useMutationState` derives each row's failure from the mutation cache
 */
import { RecipeCollectionAddedVia, type Recipe } from '@kitchensink/recipe-core';
import {
    invalidateCollections,
    recipeServiceKeys,
    useRecipeServiceClient,
} from '@kitchensink/recipe-service-client/hooks';
import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';

/** The key every picker toggle of one collection shares: a prefix over each pair's own key. */
export const memberKey = (collectionId: string) =>
    ['recipe-service', 'mutations', 'collectionMember', collectionId] as const;

/** What one toggle asks for. */
export interface MemberToggle {
    /** `true` adds the recipe to the collection, `false` removes it. */
    readonly member: boolean;
    /** The recipe's title, carried so the announcement and the failure can name it. */
    readonly title: string;
}

/**
 * The detail with one recipe set on or off, as the picker's optimistic update. An absent detail is left absent. Pure.
 *
 * @param detail - The cached collection, if there is one.
 * @param recipe - The recipe being toggled.
 * @param member - Whether it should be a member.
 * @returns The new detail.
 */
export function withMember(
    detail: CollectionWithRecipes | undefined,
    recipe: Recipe,
    member: boolean,
): CollectionWithRecipes | undefined {
    if (detail === undefined) {
        return undefined;
    }

    const present = detail.recipes.some((entry) => entry.id === recipe.id);
    const recipes = member
        ? present
            ? detail.recipes
            : [...detail.recipes, { ...recipe, addedVia: RecipeCollectionAddedVia.MANUAL }]
        : detail.recipes.filter((entry) => entry.id !== recipe.id);

    return { ...detail, recipes, ...(detail.recipeCount === undefined ? {} : { recipeCount: recipes.length }) };
}

/** What a picker row gets. */
export interface MemberToggleControl {
    /** Ask for the recipe to be a member (`true`) or not (`false`). */
    readonly press: (member: boolean) => void;
    /** The last toggle of this recipe failed, and none has been made since. */
    readonly failed: boolean;
    /** The direction that failed, for the message ("add" or "remove"); meaningful only while {@link failed}. */
    readonly failedMember: boolean;
}

/**
 * One picker row's toggle.
 *
 * @param collectionId - The collection being edited.
 * @param recipe - The recipe this row stands for.
 * @returns The press, and whether the last press failed.
 * @sideEffect Sends add / remove requests and rewrites the collection's cached detail.
 */
export function useMemberToggle(collectionId: string, recipe: Recipe): MemberToggleControl {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();
    const detailKey = recipeServiceKeys.collection(collectionId);
    const pairKey = [...memberKey(collectionId), recipe.id] as const;

    const mutation = useMutation({
        mutationKey: pairKey,
        scope: { id: `member:${collectionId}:${recipe.id}` },
        mutationFn: async ({ member }: MemberToggle): Promise<void> => {
            if (member) {
                await client.addRecipeToCollection(collectionId, recipe.id);
            } else {
                await client.removeRecipeFromCollection(collectionId, recipe.id);
            }
        },
        onMutate: async ({ member }) => {
            await queryClient.cancelQueries({ queryKey: detailKey });
            queryClient.setQueryData<CollectionWithRecipes>(detailKey, (detail) => withMember(detail, recipe, member));
        },
        onError: (_error, { member }) => {
            queryClient.setQueryData<CollectionWithRecipes>(detailKey, (detail) => withMember(detail, recipe, !member));
        },
        onSettled: () => {
            if (queryClient.isMutating({ mutationKey: memberKey(collectionId) }) === 1) {
                invalidateCollections(queryClient);
            }
        },
    });

    const [latest] = useMutationState({
        filters: { mutationKey: pairKey },
        select: (entry) => ({
            status: entry.state.status,
            member: (entry.state.variables as MemberToggle | undefined)?.member ?? true,
            submittedAt: entry.state.submittedAt,
        }),
    })
        .slice()
        .sort((left, right) => right.submittedAt - left.submittedAt);

    return {
        press: (member) => mutation.mutate({ member, title: recipe.title }),
        failed: latest?.status === 'error',
        failedMember: latest?.member ?? true,
    };
}
