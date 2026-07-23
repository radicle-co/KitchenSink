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
 * `IDENTITY_SYNC_PENDING_CODE`). Making a recipe private is a premium capability (C-004), gated on the
 * viewer's `account.subscriptionTier` read via `useUserProfile` — the SAME tier signal the mobile detail
 * screen gates on, so both platforms behave identically (CODING_STANDARDS §14). Free-tier owners see the
 * private option disabled with a localized upgrade reason; the tier read fails safe (gated OFF) while the
 * profile is still loading or absent.
 */
import { useAuth } from '@clerk/nextjs';
import {
    RecipeCloneAction,
    RecipeDeleteDialog,
    RecipeDetailView,
    RecipeRatingDisplay,
    RecipeRatingInput,
    RecipeVisibilityToggle,
    filtersToQueryString,
    ratingModeFor,
    resolveSelectedStars,
    useCookingProgress,
    type RatingSelectionOverride,
    type RecipeRatingError,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useRecipe,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FC } from 'react';

import { useUserProfile } from '@/hooks/useUserProfile';
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
    const profile = useUserProfile();
    const query = useRecipe(id);
    const deleteRecipe = useDeleteRecipe();
    const setVisibility = useSetRecipeVisibility();
    const cloneRecipe = useCloneRecipe();
    const setRating = useSetRecipeRating();
    const deleteRating = useDeleteRecipeRating();
    // D4/D5: session-scoped cooking progress lives in the orchestration layer (survives navigate-away-and-back);
    // the presentational view receives the checked sets + toggles as props.
    const cooking = useCookingProgress(id);
    const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
    // The viewer's OPTIMISTIC rating action this session, or undefined to defer to the server. The detail's
    // `viewerRating` (the viewer's own prior rating) is the source of truth and pre-selects on load; this only
    // bridges the write→refetch gap so the stars don't flicker back before the refetch lands. See
    // `resolveSelectedStars`. Reset below when the route switches recipes so it can't leak across recipes.
    const [ratingOverride, setRatingOverride] = useState<RatingSelectionOverride>(undefined);
    const [ratingRecipeId, setRatingRecipeId] = useState(id);

    if (ratingRecipeId !== id) {
        // The App Router keeps THIS container mounted across a `/recipes/A` → `/recipes/B` navigation (same
        // dynamic-segment pattern), so on an id change we must scrub every scrap of the previous recipe's
        // mutation state. Resetting the mutations (not just the optimistic override) clears their `error` and
        // `isPending` too — otherwise recipe A's failed/in-flight write leaks onto B, which shares the same
        // `useMutation` instance, and B falsely shows A's error or busy state. This covers the rating writes
        // AND (B17) the visibility toggle + delete, whose errors now render banners. The render-phase
        // `setRatingRecipeId` forces an immediate re-render, by which point the observers read as idle.
        setRatingRecipeId(id);
        setRatingOverride(undefined);
        setRating.reset();
        deleteRating.reset();
        setVisibility.reset();
        deleteRecipe.reset();
    }

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

    // C-004: making a recipe private is a premium capability, gated on the viewer's subscription tier — the
    // same signal the mobile detail screen uses. Fails safe (OFF) while the profile loads or is absent.
    const canGoPrivate = profile.data?.account.subscriptionTier === 'premium';

    // FR-013 ratings: the viewer may rate a recipe they can read and do NOT own (Sc8). The read-through user
    // resolution guarantees the recipe is one the viewer can see, so ownership is the only client-side gate;
    // the backend enforces the rest (Sc8 own-recipe 403, Sc9 not-found for the unreadable). A rating write's
    // error is mapped to the honest surface: a not-found (the client's 404 shape) is "not available" (Sc9),
    // never a distinct "forbidden"; anything else is generic. Set errors win over remove (only one is in
    // flight at a time — the control disables its inputs while pending).
    const ratingMode = ratingModeFor({ viewerId, ownerId: recipe.ownerId });
    const ratingError = setRating.error ?? deleteRating.error;
    const ratingErrorKind: RecipeRatingError | undefined =
        ratingError === null || ratingError === undefined
            ? undefined
            : isNotFoundError(ratingError)
              ? 'notAvailable'
              : 'generic';
    // The stars the input pre-selects: the server's `viewerRating` once loaded, bridged by the optimistic
    // override during a write so it never flickers. The community `averageRating` stays the displayed score.
    const selectedStars = resolveSelectedStars(ratingOverride, recipe.viewerRating);

    return (
        <>
            <RecipeDetailView
                recipe={recipe}
                checkedIngredients={cooking.checkedIngredients}
                onToggleIngredient={cooking.toggleIngredient}
                checkedSteps={cooking.checkedSteps}
                onToggleStep={cooking.toggleStep}
                onFilterByTag={(tag) =>
                    // D6: deep-link to the SAME visibility-scoped search the discover page runs; reuse its
                    // canonical query encoder so the tag round-trips exactly (no new unfiltered tag endpoint).
                    router.push(`/${locale}/discover?${filtersToQueryString({ tags: [tag] }, '')}` as Route)
                }
            />

            {/* Orchestration picks the render component (B15): the owner sees the read-only aggregate (Sc8);
                everyone else gets the interactive input. The own-recipe gate lives HERE, not in a mode prop. */}
            {ratingMode === 'own' ? (
                <RecipeRatingDisplay average={recipe.averageRating} ratingCount={recipe.ratingCount} />
            ) : (
                <RecipeRatingInput
                    average={recipe.averageRating}
                    ratingCount={recipe.ratingCount}
                    selectedStars={selectedStars}
                    pending={setRating.isPending || deleteRating.isPending}
                    error={ratingErrorKind}
                    onRate={(stars) =>
                        setRating.mutate({ id, input: { stars } }, { onSuccess: () => setRatingOverride({ stars }) })
                    }
                    onRemove={() =>
                        deleteRating.mutate(id, { onSuccess: () => setRatingOverride({ stars: undefined }) })
                    }
                />
            )}

            {isOwner && (
                <>
                    {/* W2/D1: the web detail was a dead end — restore the owner's entry points to the editor
                        and the version history (mirrors mobile's RecipeDetailScreen header). */}
                    <Link href={`/${locale}/recipes/${id}/edit` as Route}>{recipes.actions.editAction}</Link>
                    <Link href={`/${locale}/recipes/${id}/versions` as Route}>{recipes.actions.versionHistory}</Link>
                    <RecipeVisibilityToggle
                        visibility={recipe.visibility}
                        canGoPrivate={canGoPrivate}
                        disabledReason={recipes.actions.premiumRequired}
                        // B17 — a failed toggle snaps back to the query's value; surface an honest reason so
                        // the change doesn't fail silently. Cleared on the next attempt (and on recipe switch).
                        error={setVisibility.error !== null && setVisibility.error !== undefined}
                        onChange={(visibility) => setVisibility.mutate({ id, visibility })}
                    />
                    <button type="button" aria-haspopup="dialog" onClick={() => setDeleteDialogOpen(true)}>
                        {recipes.actions.deleteAction}
                    </button>
                    <RecipeDeleteDialog
                        recipeTitle={recipe.title}
                        open={isDeleteDialogOpen}
                        deleting={deleteRecipe.isPending}
                        // B17 — a failed delete left the dialog open with no explanation; surface an honest
                        // reason inside it. Cleared on the next attempt (and on recipe switch).
                        error={deleteRecipe.error !== null && deleteRecipe.error !== undefined}
                        onConfirm={() =>
                            deleteRecipe.mutate(id, {
                                onSuccess: () => router.push(`/${locale}/recipes` as Route),
                            })
                        }
                        onCancel={() => setDeleteDialogOpen(false)}
                    />
                </>
            )}

            {/* W2/D7: an owner never clones their OWN recipe — the orchestration layer omits the control
                entirely (absent, not a disabled button), matching mobile's `isPublic && !isOwner` gate. */}
            {!isOwner && (
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
            )}
        </>
    );
};
