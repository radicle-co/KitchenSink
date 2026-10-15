'use client';

/**
 * Container for the recipe-detail route: reads a single recipe under a suspense boundary and renders the
 * shared, presentational `RecipeDetailView` once it settles, plus the recipe-action building blocks below it —
 * owner-only delete (T068) and visibility (T074), and a public-recipe clone (T075). The fetch-state
 * affordances belong to the boundary, not the building blocks: `Suspense` renders the loading status, the error
 * boundary renders a distinct not-found message (no retry) or the generic error with a retry that refetches, and
 * both are localized through the web dictionary (`useMessages`).
 *
 * `/recipes/[id]` is server-prefetched, so the boundary is `ClientQueryBoundary` with the prefetched detail key: a
 * successful prefetch ships the recipe in the server HTML, a failed one ships the loading status and the browser
 * reads after hydration (B19). The settled view is keyed on the id, so a `/recipes/A` → `/recipes/B` navigation
 * (which the App Router serves from the SAME mounted container) remounts it — every mutation, the delete dialog and
 * the cooking progress start fresh for B, and nothing of A's can leak onto it.
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
 * `canClone` policy predicates, the SAME predicates the mobile detail screen evaluates, so the two
 * platforms can never diverge on a gate (this closes D7, where the clone gate previously disagreed: web
 * ignored ownership while mobile checked it). Free-tier owners see the private option disabled with a
 * localized upgrade reason; the tier read fails safe (gated OFF) while the profile is still loading or absent.
 *
 * The recipe page (build spec §6): the action row's primary — Edit recipe for the owner, Save a copy for another cook
 * who may clone; Back and the ⋯ menu, whose entries come from the shared `detailMenuOf` (Version history, Make
 * private/public, Clear checks, then Delete); and the rating block in the view's `rating` slot, under the nutrition.
 * Below 840 (where the tab bar replaces the sidebar) Back and ⋯ are discs over the hero photo; from 840 Back is the
 * eyebrow link above the meta line and ⋯ sits in the action row. Both placements are drawn and one is hidden by a
 * VIEWPORT query (`nav:`), the same pairing the view uses for Screen on. The cook's marks, the serving scale and
 * Screen on are bound by the view itself; this container reads the marks only to offer Clear checks.
 */
import { useAuth } from '@clerk/nextjs';
import {
    RecipeDeleteDialog,
    RecipeDetailView,
    RecipeRatingDisplay,
    RecipeRatingInput,
    detailMenuOf,
    RecipeUpsellSheet,
    RecipeMakePublicDialog,
    useGatedPrivate,
    privateRefusalOf,
    useMakePublicConfirm,
    useServerRefusedPrivate,
    editorMessages,
    FINISHED_OUTCOME_PARAM,
    finishedNoticeOf,
    isUnreachableRecovery,
    parseFinishedParam,
    ratingModeFor,
    recipeActionMessages,
    recipeMessages,
    useCookMarks,
    type DetailMenuItem,
    type RecipeRatingError,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { ActionMenu, type ActionMenuItem } from '@commise/ui/action-menu';
import { Button, buttonSurfaceClass, GHOST_EDGE_CLASS } from '@commise/ui/button';
import { HeroButton } from '@commise/ui/hero-button';
import { Icon } from '@commise/ui/icon';
import { ScrollHost, useScrollHost } from '@commise/ui/scroll-host';
import { knownPaidFeaturesOf, paidFeatureStateOf } from '@commise/features-account';
import { RecipeVisibility, canClone, isOwner, makeViewer } from '@kitchensink/recipe-core';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useRecipeServiceClient,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ComponentProps, type FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { dataSourcesHref } from '@/components/app/dataSourcesHref';
import { RecipeDetailRouteLoading } from '@/components/recipes/RecipeDetailRouteLoading';
import { RecipeLoadError } from '@/components/recipes/RecipeLoadError';
import { recipesAfterDeleteHref } from '@/components/recipes/recipesAfterDeleteHref';
import { useAddressNotice } from '@/hooks/useAddressNotice';
import { useUserProfile } from '@/hooks/useUserProfile';

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
 * The live recipe-detail container: the read boundary around the settled view.
 *
 * @param props - The recipe id to load.
 * @returns The boundary rendering the loading status, a not-found or retrying error, or the settled detail.
 */
export const RecipeDetailContainer: FC<RecipeDetailContainerProps> = ({ id }) => {
    const client = useRecipeServiceClient();
    // Built ONCE and handed to both sides, so the key the boundary checks for a prefetch and the read it gates can
    // never drift apart.
    const detail = recipeQueries(client).detail(id);

    return (
        <ClientQueryBoundary
            prefetchedKeys={[detail.queryKey]}
            loading={<RecipeDetailRouteLoading />}
            renderError={({ error, resetErrorBoundary }) => (
                <RecipeLoadError error={error} onRetry={resetErrorBoundary} />
            )}
            resetKeys={[id]}
        >
            <SettledRecipeDetail key={id} id={id} detail={detail} />
        </ClientQueryBoundary>
    );
};

/** The recipe page's sections, in page order: the ids of their headings. */
const DETAIL_SECTIONS = ['ingredients', 'steps', 'nutrition'] as const;

/** Where the scroll spy's activation line sits below the top of the window: under the sticky section switch. */
const SECTION_ACTIVATION_PX = 112;

/**
 * The recipe view, told which section the reader is in by the page's `ScrollHost`.
 *
 * @param props - The view's props.
 * @returns The view.
 */
const SectionAwareDetailView: FC<ComponentProps<typeof RecipeDetailView>> = (props) => {
    const { current } = useScrollHost();

    return <RecipeDetailView {...props} {...(current === undefined ? {} : { currentSection: current })} />;
};

/** Props for {@link SettledRecipeDetail}. */
interface SettledRecipeDetailProps extends RecipeDetailContainerProps {
    /** The detail read the boundary gates — the same options object whose key it checked. */
    readonly detail: ReturnType<ReturnType<typeof recipeQueries>['detail']>;
}

/**
 * The detail once its read has settled: the shared view plus every action wired to its mutation.
 *
 * @param props - The recipe id and its read.
 * @returns The detail view with its action blocks.
 */
const SettledRecipeDetail: FC<SettledRecipeDetailProps> = ({ id, detail }) => {
    if (id.length === 0) {
        // Nothing can be read for an empty id; failing into the boundary gives the viewer the generic error and its
        // retry, never a spinner that cannot settle.
        throw new Error('A recipe detail needs a recipe id.');
    }

    const { locale } = useParams<{ locale: string }>();
    const router = useRouter();
    const { sessionClaims } = useAuth();
    const profile = useUserProfile();
    const query = useSuspenseQuery(detail);
    // A failed refresh of the recipe on screen keeps it (a suspense read throws only when it has no data) and is
    // reported here.
    const refreshNotice = useRefreshNotice(query);
    // Plan 002 R2 — the retry behind the notice for lines food could not name. A SECOND notice state over the same
    // query, counting only retries that loaded every name, so its recoveries move focus to the Ingredients heading
    // (not the title) and only when the button the cook pressed is gone.
    const unreachableRetry = useRefreshNotice(query, { recovered: isUnreachableRecovery });
    const deleteRecipe = useDeleteRecipe();
    const setVisibility = useSetRecipeVisibility();
    const cloneRecipe = useCloneRecipe();
    const setRating = useSetRecipeRating();
    const deleteRating = useDeleteRecipeRating();
    // The view binds the cook's marks itself; the ⋯ menu reads the same marks to offer Clear checks.
    const marks = useCookMarks(id);
    const { detailActions, moreMenu, visibility: visibilityCopy } = useMessages(recipeActionMessages);
    const { detail: detailCopy } = useMessages(recipeMessages);
    const editorCopy = useMessages(editorMessages);

    // E8: the editor finished and navigated here with `?done=<outcome>[.<refusal>]`; say it once. The parameter is the
    // reader's to forge: only the exact spellings count.
    useAddressNotice(FINISHED_OUTCOME_PARAM, (value) => {
        const finished = parseFinishedParam(value);

        return finished === undefined ? undefined : finishedNoticeOf(finished, editorCopy);
    });

    const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const recipe = query.data;
    // Plan 2026-10-14-009 D14: whether Make private is offered, and whether it applies or opens the Premium sheet, is
    // decided in ONE place, `useGatedPrivate`, from the viewer's paid features alone (owner ruling 2026-10-13).
    const privateGate = useGatedPrivate({
        state: paidFeatureStateOf(profile),
        saved: recipe.visibility,
        apply: () => setVisibility.mutate({ id: id, visibility: RecipeVisibility.PRIVATE }),
    });
    // Q5 (UX SPECIFY 2026-10-15): a downgraded owner confirms Make public first; the confirm stays up, busy, while the
    // change is in flight, and says a failure inside itself.
    const serverRefusedPrivate = useServerRefusedPrivate(id);
    // The confirm's words say what is KNOWN: a failed profile read is "may not", never "won't" (review).
    const makePublic = useMakePublicConfirm({
        state: knownPaidFeaturesOf(profile) ?? 'loading',
        saved: recipe.visibility,
        apply: (done) => setVisibility.mutate({ id, visibility: RecipeVisibility.PUBLIC }, { onSuccess: done }),
    });
    const viewerId = readViewerId(sessionClaims);
    // P4: ONE Viewer value object, built from this platform's identity signal (Clerk's `external_id` claim), feeds every
    // gate below through the shared policy predicates — the SAME predicates the mobile detail screen evaluates (D7).
    const viewer = makeViewer({ id: viewerId });
    const viewerIsOwner = isOwner(recipe, viewer);
    // D7: a viewer may clone a PUBLIC recipe they do not own — the SAME `canClone` predicate mobile now
    // evaluates, closing the drift where web ignored ownership and mobile checked it.
    const viewerCanClone = canClone(recipe, viewer);

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

    // §6.1/§6.4: the action row is the primary — Edit recipe for the owner, Save a copy for another cook — and the ⋯
    // menu, whose entries are decided once for both platforms (`detailMenuOf`). The two NAVIGATIONS stay real links: a
    // `<button onClick={router.push}>` would lose the link role, ⌘-click and open-in-new-tab.
    //
    // ⛔ The delete CONFIRMATION DIALOG does NOT live in the menu: it stays a sibling below, so it survives the menu
    // closing while the dialog is open.
    const menu = detailMenuOf({
        owner: viewerIsOwner,
        isPublic: recipe.visibility === RecipeVisibility.PUBLIC,
        hasMarks: marks.hasMarks,
        offersPrivate: privateGate.offersPrivate,
    });
    const versionsHref = `/${locale}/recipes/${id}/versions`;

    const menuItem = (item: DetailMenuItem): ActionMenuItem => {
        switch (item) {
            case 'versions':
                return {
                    id: item,
                    label: detailActions.versionHistory,
                    icon: 'clock',
                    onSelect: () => router.push(versionsHref as Route),
                };
            case 'makePrivate':
                return {
                    id: item,
                    label: detailActions.makePrivate,
                    icon: 'lock',
                    onSelect: privateGate.request,
                };
            case 'makePublic':
                return {
                    id: item,
                    label: detailActions.makePublic,
                    icon: 'globe',
                    // A fresh confirm starts clean: an earlier failure is not news to it (review S3).
                    onSelect: () => {
                        setVisibility.reset();
                        makePublic.request();
                    },
                };
            case 'clearChecks':
                return { id: item, label: detailActions.clearChecks, icon: 'rotateCcw', onSelect: marks.clear };
        }
    };

    // The ⋯ menu is drawn twice — a disc over the hero below 840, a plain trigger in the action row from 840 — so it is
    // built by appearance. Each instance keeps its own open state, and the hidden one is `display: none`, so it is
    // neither focusable nor announced.
    const moreActions = (appearance: 'plain' | 'disc') =>
        menu.items.length > 0 || menu.destructive !== undefined ? (
            <ActionMenu
                triggerLabel={moreMenu.triggerFor.replace('{title}', recipe.title)}
                title={moreMenu.title}
                closeLabel={moreMenu.close}
                items={menu.items.map(menuItem)}
                appearance={appearance}
                {...(menu.destructive === undefined
                    ? {}
                    : {
                          destructiveItem: {
                              id: 'delete',
                              label: detailActions.deleteRecipe,
                              icon: 'trash',
                              onSelect: () => setDeleteDialogOpen(true),
                          },
                      })}
            />
        ) : null;
    const hasMenu = menu.items.length > 0 || menu.destructive !== undefined;
    const primary = viewerIsOwner ? (
        <Link href={`/${locale}/recipes/${id}/edit` as Route} className={buttonSurfaceClass('primary')}>
            <Icon name="pencilLine" size={20} />
            {detailActions.editRecipe}
        </Link>
    ) : viewerCanClone ? (
        <Button
            icon="copyPlus"
            busy={cloneRecipe.isPending}
            onPress={() =>
                // A copy needs a real edit before it can be published (FR-005b), so it opens in the editor.
                cloneRecipe.mutate(id, {
                    onSuccess: (created) => router.push(`/${locale}/recipes/${created.id}/edit` as Route),
                })
            }
        >
            {detailActions.saveCopy}
        </Button>
    ) : null;
    const headerActions =
        primary === null && !hasMenu ? undefined : (
            <>
                {primary}
                <span className="hidden nav:contents">{moreActions('plain')}</span>
            </>
        );
    const backHref = `/${locale}/recipes`;
    const backLabel = detailCopy.backTo.replace('{parent}', detailActions.backToRecipes);

    return (
        <>
            {/* Blueprint A7: the page's one scroll spy reads the section headings by id; the view marks the current
                one in its section switch. The activation line sits under the sticky switch (the headings'
                `scroll-mt-28`). */}
            <ScrollHost sections={DETAIL_SECTIONS} activationOffset={SECTION_ACTIVATION_PX}>
                <SectionAwareDetailView
                    recipe={recipe}
                    dataSourcesHref={dataSourcesHref(locale)}
                    editHref={`/${locale}/recipes/${id}/edit`}
                    versionsHref={viewerIsOwner ? versionsHref : undefined}
                    viewerIsOwner={viewerIsOwner}
                    refreshNotice={refreshNotice}
                    unreachableRetry={unreachableRetry}
                    headerActions={headerActions}
                    heroControls={
                        <>
                            <span className="nav:hidden">
                                <HeroButton
                                    icon="chevronLeft"
                                    label={backLabel}
                                    href={backHref}
                                    onPress={() => router.push(backHref as Route)}
                                />
                            </span>
                            {hasMenu ? <span className="nav:hidden">{moreActions('disc')}</span> : null}
                        </>
                    }
                    back={
                        <span className="hidden nav:contents">
                            <Link
                                href={backHref as Route}
                                className={`${buttonSurfaceClass('ghost', 'sm')} ${GHOST_EDGE_CLASS} self-start`}
                            >
                                <Icon name="chevronLeft" size={16} />
                                {detailActions.backToRecipes}
                            </Link>
                        </span>
                    }
                    rating={
                        // Orchestration picks the render component (B15): the owner sees the read-only aggregate (Sc8);
                        // everyone else gets the interactive input. The own-recipe gate lives HERE, not in a mode prop.
                        ratingMode === 'own' ? (
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
                        )
                    }
                />
            </ScrollHost>

            {/* B17 — a failed visibility change snaps back to the query's value; say so rather than fail silently. The
                make-public confirm says its own failure inside itself, so it is not said twice. A Private the server
                refused — the editor's follow-up included, answered after the editor left — is said in its own words,
                because trying again cannot succeed. */}
            {serverRefusedPrivate ? (
                <p role="alert" className="max-w-detail text-meta text-danger-text">
                    {
                        visibilityCopy.privateRefused[
                            privateRefusalOf(knownPaidFeaturesOf(profile) ?? 'loading') ?? 'final'
                        ]
                    }
                </p>
            ) : (
                setVisibility.error !== null &&
                !makePublic.dialog.open && (
                    <p role="alert" className="max-w-detail text-meta text-danger-text">
                        {visibilityCopy.error}
                    </p>
                )
            )}

            {viewerIsOwner && <RecipeUpsellSheet {...privateGate.sheet} />}

            {viewerIsOwner && (
                <RecipeMakePublicDialog
                    {...makePublic.dialog}
                    busy={setVisibility.isPending}
                    error={setVisibility.error !== null}
                />
            )}

            {viewerIsOwner && (
                <RecipeDeleteDialog
                    recipeTitle={recipe.title}
                    open={isDeleteDialogOpen}
                    deleting={deleteRecipe.isPending}
                    // B17 — a failed delete left the dialog open with no explanation; surface an honest
                    // reason inside it. Cleared on the next attempt (and on recipe switch).
                    error={deleteRecipe.error !== null}
                    onConfirm={() =>
                        deleteRecipe.mutate(id, {
                            // "Recipe deleted" is said by the page this lands on: a snackbar raised here would die with
                            // this page's shell (`recipesAfterDeleteHref`).
                            onSuccess: () => router.push(recipesAfterDeleteHref(locale) as Route),
                        })
                    }
                    onCancel={() => setDeleteDialogOpen(false)}
                />
            )}
        </>
    );
};
