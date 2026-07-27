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
 * A single `Viewer` (P4, `@kitchensink/recipe-core`) is built once per render from the recipe's `ownerId`
 * key — the app-user ULID read off Clerk's `external_id` session claim, the SAME claim the recipe service
 * uses as the owner key (see `IDENTITY_SYNC_PENDING_CODE`) — plus `useUserProfile`'s subscription tier. Every
 * ownership/clone/tier gate below reads from that ONE `Viewer` through the shared `isOwner`/`canClone`/
 * `canGoPrivate` policy predicates, the SAME predicates the mobile detail screen evaluates, so the two
 * platforms can never diverge on a gate (this closes D7, where the clone gate previously disagreed: web
 * ignored ownership while mobile checked it). Free-tier owners see the private option disabled with a
 * localized upgrade reason; the tier read fails safe (gated OFF) while the profile is still loading or absent.
 *
 * Recipe-detail wireframe parity (C1/C3/C4): a Back control returns to the recipe list (C1, mirroring
 * mobile's `onBack`); the header keeps Edit as the sole primary owner control, with Version history, the
 * visibility toggle, and the delete trigger grouped behind a `MoreActionsMenu` (C4, `[Edit] [More]`); the
 * clone action is passed into `RecipeDetailView`'s `footerActions` slot so it renders alongside the version +
 * visibility badges in ONE grouped footer row (C3), instead of as a separate block.
 */
import { useAuth } from '@clerk/nextjs';
import {
    MoreActionsMenu,
    RecipeCloneAction,
    RecipeDeleteDialog,
    RecipeDetailView,
    RecipeRatingDisplay,
    RecipeRatingInput,
    RecipeVisibilityToggle,
    filtersToQueryString,
    ratingModeFor,
    useCookingProgress,
    type RecipeRatingError,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { buttonSurfaceClass } from '@commise/ui/button';
import { canClone, canGoPrivate, isOwner, makeViewer } from '@kitchensink/recipe-core';
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
    const [ratingRecipeId, setRatingRecipeId] = useState(id);

    if (ratingRecipeId !== id) {
        // The App Router keeps THIS container mounted across a `/recipes/A` → `/recipes/B` navigation (same
        // dynamic-segment pattern), so on an id change we must scrub every scrap of the previous recipe's
        // mutation state. Resetting the mutations clears their `error` and `isPending` — otherwise recipe A's
        // failed/in-flight write leaks onto B, which shares the same `useMutation` instance, and B falsely
        // shows A's error or busy state. This covers the rating writes AND (B17) the visibility toggle +
        // delete, whose errors now render banners. The render-phase `setRatingRecipeId` forces an immediate
        // re-render, by which point the observers read as idle.
        setRatingRecipeId(id);
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
    // P4: ONE Viewer value object, built from this platform's identity signals (Clerk's `external_id` claim
    // + the profile's subscription tier), feeds every gate below through the shared policy predicates — the
    // SAME predicates the mobile detail screen evaluates (D7).
    const viewer = makeViewer({ id: viewerId, subscriptionTier: profile.data?.account.subscriptionTier });
    const viewerIsOwner = isOwner(recipe, viewer);
    // D7: a viewer may clone a PUBLIC recipe they do not own — the SAME `canClone` predicate mobile now
    // evaluates, closing the drift where web ignored ownership and mobile checked it.
    const viewerCanClone = canClone(recipe, viewer);
    // C-004: making a recipe private is a premium capability, gated on the viewer's subscription tier — the
    // same signal the mobile detail screen uses. Fails safe (OFF) while the profile loads or is absent
    // (`makeViewer` maps an absent/unrecognized tier to `'free'`).
    const viewerCanGoPrivate = canGoPrivate(viewer);

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
    // The stars the input pre-selects: the server's `viewerRating` (DA4 — `useSetRecipeRating` /
    // `useDeleteRecipeRating` patch this optimistically in the cache on `onMutate`, so it never flickers back
    // to the pre-write value before the refetch lands). The community `averageRating` stays the displayed score.
    const selectedStars = recipe.viewerRating;

    return (
        <>
            {/* C1 wireframe parity: an explicit in-app back control on the detail header — mirrors mobile's
                `onBack` (RecipeDetailScreen), which the web detail never had (it relied on browser back). */}
            <Link href={`/${locale}/recipes` as Route} className={buttonSurfaceClass('secondary')}>
                {recipes.actions.backAction}
            </Link>
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
                // C3 wireframe parity: the clone action lives IN the detail's grouped footer row, alongside
                // the version + visibility badges, rather than as a loose block below every other control.
                // W2/D7: an owner never clones their OWN recipe — the orchestration layer omits the slot
                // entirely (absent, not a disabled button). `canClone` already excludes the owner (P4); this
                // outer guard additionally hides the control for the owner rather than merely disabling it.
                footerActions={
                    !viewerIsOwner && (
                        <RecipeCloneAction
                            canClone={viewerCanClone}
                            sourceAttribution={recipe.sourceAttribution}
                            cloning={cloneRecipe.isPending}
                            onClone={() =>
                                cloneRecipe.mutate(id, {
                                    onSuccess: (created) => router.push(`/${locale}/recipes/${created.id}` as Route),
                                })
                            }
                        />
                    )
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
                    onRate={(stars) => setRating.mutate({ id, input: { stars } })}
                    onRemove={() => deleteRating.mutate(id)}
                />
            )}

            {viewerIsOwner && (
                <>
                    {/* C4 wireframe parity (`[Edit] [More]`): Edit stays the sole primary, always-visible
                        owner control (W2/D1's restored entry point); Version history, visibility, and the
                        delete trigger — the SECONDARY actions — move behind the "More" overflow menu. The
                        delete CONFIRMATION dialog stays a sibling, not menu content, so it survives the menu
                        closing (e.g. its own outside-click) while it is open. */}
                    {/* DS surfaces (design-system migration): every owner control below now draws its palette,
                        pill geometry, focus ring, and 44px touch floor from ONE source — `buttonSurfaceClass`,
                        the same recipe the `Button` component itself renders — instead of the bare, surface-less
                        elements these used to be. The two NAVIGATIONS stay real links on purpose: a
                        `<button onClick={router.push}>` would lose the link role, ⌘-click, and open-in-new-tab. */}
                    <div className="flex items-center gap-2">
                        <Link href={`/${locale}/recipes/${id}/edit` as Route} className={buttonSurfaceClass('primary')}>
                            {recipes.actions.editAction}
                        </Link>
                        <MoreActionsMenu>
                            <Link
                                href={`/${locale}/recipes/${id}/versions` as Route}
                                className={buttonSurfaceClass('secondary')}
                            >
                                {recipes.actions.versionHistory}
                            </Link>
                            <RecipeVisibilityToggle
                                visibility={recipe.visibility}
                                canGoPrivate={viewerCanGoPrivate}
                                disabledReason={recipes.actions.premiumRequired}
                                // B17 — a failed toggle snaps back to the query's value; surface an honest
                                // reason so the change doesn't fail silently. Cleared on the next attempt (and
                                // on recipe switch).
                                error={setVisibility.error !== null && setVisibility.error !== undefined}
                                onChange={(visibility) => setVisibility.mutate({ id, visibility })}
                            />
                            {/* The DS destructive surface on a plain `<button>` rather than the `Button`
                                component, because this trigger MUST keep `aria-haspopup="dialog"` (it announces
                                that activating it opens the confirmation) and the DS Button's contract carries no
                                popup hint. It has no in-flight state of its own — the delete's busy spinner
                                belongs to the dialog's confirm control, which IS a real DS `Button`. */}
                            <button
                                type="button"
                                aria-haspopup="dialog"
                                onClick={() => setDeleteDialogOpen(true)}
                                className={buttonSurfaceClass('destructive')}
                            >
                                {recipes.actions.deleteAction}
                            </button>
                        </MoreActionsMenu>
                    </div>
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
        </>
    );
};
