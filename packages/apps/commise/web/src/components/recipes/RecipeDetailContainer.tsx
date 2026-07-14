'use client';

/**
 * Container for the recipe-detail route: fetches a single recipe via `useRecipe(id)` and renders the
 * shared, presentational `RecipeDetailView` on success, plus the recipe-action building blocks below it —
 * owner-only delete (T068) and visibility (T074), and a public-recipe clone (T075). The fetch-state
 * affordances (loading, generic error with retry, and a distinct not-found message) belong to the app, not
 * the building blocks, and are localized through the web dictionary (`useMessages`).
 *
 * Remote state stays in TanStack Query — this component derives its view from the query, never copying the
 * recipe into local state; the only local state is the ephemeral delete-dialog open flag. The mutations are
 * owned by the recipe-service hooks (`useDeleteRecipe` / `useSetRecipeVisibility` / `useCloneRecipe`), which
 * invalidate the relevant caches; the container only wires the blocks' callbacks to them and handles
 * post-success navigation.
 *
 * Ownership is decided by comparing the recipe's `ownerId` (the app-user ULID) to the viewer's `external_id`
 * session claim — the SAME claim the recipe service uses as the owner key (see `@kitchensink/recipe-core`,
 * `IDENTITY_SYNC_PENDING_CODE`). Making a recipe private is a premium capability (C-004); no premium/tier
 * signal is threaded into the web client yet, so the private option is gated OFF with a localized reason —
 * see the FE-1 follow-up to thread the premium signal in.
 */
import { useAuth } from '@clerk/nextjs';
import {
    RecipeCloneAction,
    RecipeDeleteDialog,
    RecipeDetailView,
    RecipeVisibilityToggle,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useRecipe,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeDetailContainer}. */
export interface RecipeDetailContainerProps {
    /** The recipe id from the `[id]` route segment. */
    readonly id: string;
}

/**
 * Read the viewer's app-user ULID from Clerk's session claims (the `external_id` claim — the recipe
 * service's owner key). Returns `undefined` when the claim is absent so ownership stays deniably false.
 *
 * @param sessionClaims - Clerk's session claims (untyped for the custom `external_id` claim).
 * @returns The viewer's app-user ULID, or `undefined` when it is not present.
 */
function readViewerId(sessionClaims: unknown): string | undefined {
    const claims = sessionClaims as Record<string, unknown> | null;
    const externalId = claims?.['external_id'];

    return typeof externalId === 'string' ? externalId : undefined;
}

/**
 * The live recipe-detail container.
 *
 * @param props - The recipe id to load.
 * @returns The detail view with its action blocks, or a localized loading / not-found / error affordance.
 */
export const RecipeDetailContainer: FC<RecipeDetailContainerProps> = ({ id }) => {
    const { recipes } = useMessages(webMessages);
    const { locale } = useParams<{ locale: string }>();
    const router = useRouter();
    const { sessionClaims } = useAuth();
    const query = useRecipe(id);
    const deleteRecipe = useDeleteRecipe();
    const setVisibility = useSetRecipeVisibility();
    const cloneRecipe = useCloneRecipe();
    const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);

    if (query.isLoading) {
        return <div role="status" aria-label={recipes.detail.loadingLabel} />;
    }

    if (query.isError) {
        const notFound = isNotFoundError(query.error);

        return (
            <div role="alert">
                <p>{notFound ? recipes.detail.notFoundTitle : recipes.detail.errorTitle}</p>
                {!notFound && (
                    <button type="button" onClick={() => void query.refetch()}>
                        {recipes.detail.retry}
                    </button>
                )}
            </div>
        );
    }

    if (query.data === undefined) {
        // An enabled query that is neither loading nor errored should have data; guard defensively so a
        // transient undefined never crashes the view.
        return <div role="status" aria-label={recipes.detail.loadingLabel} />;
    }

    const recipe = query.data;
    const viewerId = readViewerId(sessionClaims);
    const isOwner = viewerId !== undefined && viewerId === recipe.ownerId;
    const isPublic = recipe.visibility === RecipeVisibility.PUBLIC;

    // C-004: making a recipe private is a premium capability. No premium/tier signal is threaded into the
    // web client yet, so gate the private option OFF and explain why (see the module doc's follow-up).
    const canGoPrivate = false;

    return (
        <>
            <RecipeDetailView recipe={recipe} />

            {isOwner && (
                <>
                    <RecipeVisibilityToggle
                        visibility={recipe.visibility}
                        canGoPrivate={canGoPrivate}
                        disabledReason={recipes.actions.premiumRequired}
                        onChange={(visibility) => setVisibility.mutate({ id, visibility })}
                    />
                    <button type="button" aria-haspopup="dialog" onClick={() => setDeleteDialogOpen(true)}>
                        {recipes.actions.deleteAction}
                    </button>
                    <RecipeDeleteDialog
                        recipeTitle={recipe.title}
                        open={isDeleteDialogOpen}
                        deleting={deleteRecipe.isPending}
                        onConfirm={() =>
                            deleteRecipe.mutate(id, {
                                onSuccess: () => router.push(`/${locale}/recipes` as Route),
                            })
                        }
                        onCancel={() => setDeleteDialogOpen(false)}
                    />
                </>
            )}

            <RecipeCloneAction
                canClone={isPublic}
                sourceAttribution={recipe.sourceAttribution}
                cloning={cloneRecipe.isPending}
                onClone={() =>
                    cloneRecipe.mutate(id, {
                        onSuccess: (created) => router.push(`/${locale}/recipes/${created.id}` as Route),
                    })
                }
            />
        </>
    );
};
