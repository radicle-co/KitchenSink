/**
 * Recipe-detail screen (mobile). Drives the shared, presentational native `RecipeDetailView` building block from a
 * suspense read under `QueryBoundary`, which owns the localized loading state and the failure: a distinct not-found
 * message with no retry, or the generic error with a retry that refetches — the same three outcomes as the web
 * container. The settled view is keyed on `recipeId`, so a `replace`/deep-link that reuses this screen with a new id
 * remounts it: every mutation and the delete dialog start fresh, and nothing of the previous recipe can leak.
 * On top of the read view it composes the owner and viewer action blocks (T068 delete, T074 visibility,
 * T075 clone) plus edit (T067) and version-history (T069) entry points, gated by ownership and the paid features:
 *
 * - Owner actions (edit, version history, delete, visibility) render only for the recipe's owner. Make private is a
 *   paid feature (C-004): offered when granted or upsell (where it opens the Premium sheet), and not at all when the
 *   paid features are hidden or the profile is loading (plan 2026-10-14-009 D14).
 * - The clone action renders for a PUBLIC recipe the viewer does not own (US2), copying it into their recipes.
 *
 * A single `Viewer` (P4, `@kitchensink/recipe-core`) is built once per render from `useUserProfile` (the
 * viewer's app-user id); every ownership/clone gate above reads from that ONE `Viewer` through the shared
 * `isOwner`/`canClone` policy predicates, and the visibility gate from `paidFeatureStateOf` — the SAME predicates
 * the web detail container evaluates, so the two platforms can never diverge on a gate (this closes D7,
 * where the clone gate previously disagreed: web ignored ownership while mobile checked it). Every mutation
 * is owned here and reported upward so the navigator can route (back to the list after delete, to the new
 * recipe after clone). Remote state stays in the query cache — this screen derives its view state from it.
 *
 * The recipe page (build spec §6): the action row's primary — Edit recipe for the owner, Save a copy for another
 * cook who may clone; Back and the ⋯ menu are discs over the hero photo, the menu's entries coming from the shared
 * `detailMenuOf` (Version history, Make private/public, Clear checks, then Delete); the rating block goes in the
 * view's `rating` slot, under the nutrition. The cook's marks, the serving scale, Screen on and the page's scroller
 * are bound by the view itself; this screen reads the marks only to offer Clear checks, and hands the view what must
 * scroll with the page (the failed-visibility alert and the delete dialog) as its `scrollFooter`.
 *
 * Back is named for where it goes ("Back to Discover"), read from the navigator's stack read-only: the tab stacks
 * and their routes are the navigator's, and this screen only looks at the route below it.
 */
import {
    RecipeDeleteDialog,
    RecipeDetailSkeleton,
    RecipeDetailView,
    RecipeRatingDisplay,
    RecipeRatingInput,
    detailMenuOf,
    RecipeUpsellSheet,
    RecipeMakePublicDialog,
    useGatedPrivate,
    useMakePublicConfirm,
    useServerRefusedPrivate,
    isUnreachableRecovery,
    recipeMessages,
    ratingModeFor,
    recipeActionMessages,
    useCookMarks,
    type DetailMenuItem,
    type RecipeRatingError,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { ActionMenu, type ActionMenuItem } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { HeroButton } from '@commise/ui/hero-button';
import { Icon } from '@commise/ui/icon';
import { useTheme } from '@commise/ui/theme';
import { useSnackbar } from '@commise/ui/snackbar';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useRecipeServiceClient,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { NavigationContext } from '@react-navigation/native';
import { useSuspenseQuery } from '@tanstack/react-query';
import { knownPaidFeaturesOf, paidFeatureStateOf } from '@commise/features-account';
import { RecipeVisibility, canClone, isOwner, makeViewer } from '@kitchensink/recipe-core';
import type { JSX } from 'react';
import { useContext, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';
import { useUserProfile } from '../hooks/useUserProfile.js';

/** Props for {@link RecipeDetailScreen}. */
export interface RecipeDetailScreenProps {
    /** The id of the recipe to display. */
    readonly recipeId: string;
    /** Invoked when the back affordance is activated; the affordance is hidden when omitted. */
    readonly onBack?: () => void;
    /** Invoked with the recipe id when the owner opens the editor. */
    readonly onEdit?: (recipeId: string) => void;
    /** Invoked with the recipe id when the owner opens the version history. */
    readonly onViewVersions?: (recipeId: string) => void;
    /** Invoked after the recipe is successfully deleted. */
    readonly onDeleted?: () => void;
    /** Invoked with the copy's id after Save a copy; the navigator opens it in the editor (FR-005b). */
    readonly onCloned?: (recipeId: string) => void;
}

/**
 * The recipe-detail screen: the read boundary around the settled detail.
 *
 * @param props - The recipe id plus optional navigation and lifecycle callbacks.
 * @returns The loading state, a not-found or retrying error, or the populated detail view with its actions.
 */
export function RecipeDetailScreen(props: RecipeDetailScreenProps): JSX.Element {
    const { recipeId, onBack } = props;
    const { recipes: t } = useMessages(mobileMessages);
    const backLabel = useBackLabel();
    const back = <BackAffordance label={backLabel} onBack={onBack} />;

    return (
        <QueryBoundary
            loading={<RecipeDetailSkeleton label={t.detailLoading} />}
            renderError={({ error, resetErrorBoundary }) =>
                isNotFoundError(error) ? (
                    <View style={styles.center}>
                        {back}
                        <Text accessibilityRole="alert">{t.detailNotFound}</Text>
                    </View>
                ) : (
                    <View style={styles.center}>
                        {back}
                        <Text accessibilityRole="alert">{t.detailError}</Text>
                        <Button variant="secondary" icon="refreshCw" onPress={resetErrorBoundary}>
                            {t.detailRetry}
                        </Button>
                    </View>
                )
            }
            resetKeys={[recipeId]}
        >
            <SettledRecipeDetail key={recipeId} {...props} />
        </QueryBoundary>
    );
}

/** The back control, rendered only when the navigator wires a back action. */
function BackAffordance({
    label,
    onBack,
}: {
    readonly label: string;
    readonly onBack?: () => void;
}): JSX.Element | null {
    const { colors } = useTheme();

    if (onBack === undefined) {
        return null;
    }

    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onBack} style={styles.backButton}>
            {/* `chevron-left` beside the word (`buildSpec.md` §3.5, F22). */}
            <Icon name="chevronLeft" size={20} tone="actionText" />
            <Text style={[styles.backLabel, { color: colors.actionText }]}>{label}</Text>
        </Pressable>
    );
}

/**
 * The name of the screen below this one in the stack, as the Back control says it ("Back to Discover").
 *
 * @param previous - The route below this screen, if the stack has one.
 * @param detail - The recipe page's copy.
 * @param myRecipes - The name of the recipe list ("My recipes").
 * @returns The parent's name. A deep link, whose stack holds nothing below, goes to the recipe list. Pure.
 */
function backParentOf(
    previous: string | undefined,
    detail: { parentHome: string; parentDiscover: string; parentCollection: string; parentRecipe: string },
    myRecipes: string,
): string {
    switch (previous) {
        case 'HomeRoot':
            return detail.parentHome;
        case 'DiscoverRoot':
            return detail.parentDiscover;
        case 'CollectionDetail':
            return detail.parentCollection;
        case 'RecipeDetail':
            return detail.parentRecipe;
        default:
            return myRecipes;
    }
}

/**
 * The Back control's accessible name: "Back to {parent}", the parent read off the navigator's stack.
 *
 * ⛔ Never the bare "Back": Android's own navigation bar publishes a node with exactly that name.
 *
 * @returns The name.
 */
function useBackLabel(): string {
    const { detail } = useMessages(recipeMessages);
    const { detailActions } = useMessages(recipeActionMessages);
    // Read-only, and absent outside a navigator (a test, a story): no route below means the recipe list.
    const navigation = useContext(NavigationContext);
    const state = navigation?.getState();
    const previous = state?.routes[state.index - 1]?.name;

    return detail.backTo.replace('{parent}', backParentOf(previous, detail, detailActions.backToRecipes));
}

/**
 * The detail once its read has settled: the shared view plus every action wired to its mutation.
 *
 * @param props - The recipe id plus optional navigation and lifecycle callbacks.
 * @returns The populated detail view with its actions, or the loading state while the viewer profile resolves.
 * @throws {Error} For an empty recipe id — a read that cannot be made fails into the boundary, as the generic failure.
 */
function SettledRecipeDetail({
    recipeId,
    onBack,
    onEdit,
    onViewVersions,
    onDeleted,
    onCloned,
}: RecipeDetailScreenProps): JSX.Element {
    if (recipeId.length === 0) {
        throw new Error('A recipe detail needs a recipe id.');
    }

    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(recipeQueries(client).detail(recipeId));
    // A failed refresh of the recipe on screen keeps it (a suspense read throws only when it has no data) and is
    // reported by the notice, never the load error.
    const refreshNotice = useRefreshNotice(query);
    // Plan 002 R2 — the retry behind the notice for lines food could not name: a SECOND notice state over the same
    // query, counting only retries that loaded every name, so its recoveries move the screen-reader cursor to the
    // Ingredients heading (not the title) and only when the button the cook pressed is gone.
    const unreachableRetry = useRefreshNotice(query, { recovered: isUnreachableRecovery });
    // The view binds the cook's marks itself; the ⋯ menu reads the same marks to offer Clear checks.
    const marks = useCookMarks(recipeId);
    const { detailActions, moreMenu, visibility: visibilityCopy } = useMessages(recipeActionMessages);
    const theme = useTheme();
    const snackbar = useSnackbar();
    const { recipes: t } = useMessages(mobileMessages);
    const profile = useUserProfile();
    const deleteRecipe = useDeleteRecipe();
    const setVisibility = useSetRecipeVisibility();
    const cloneRecipe = useCloneRecipe();
    const setRating = useSetRecipeRating();
    const deleteRating = useDeleteRecipeRating();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const backLabel = useBackLabel();
    // Plan 2026-10-14-009 D14: whether Make private is offered, and whether it applies or opens the Premium sheet, is
    // decided in ONE place, `useGatedPrivate`, from the viewer's paid features alone (owner ruling 2026-10-13).
    const privateGate = useGatedPrivate({
        state: paidFeatureStateOf(profile),
        saved: query.data.visibility,
        apply: () => setVisibility.mutate({ id: recipeId, visibility: RecipeVisibility.PRIVATE }),
    });
    // Q5 (UX SPECIFY 2026-10-15): a downgraded owner confirms Make public first; the confirm stays up, busy, while the
    // change is in flight, and says a failure inside itself. The web page reads the same.
    const serverRefusedPrivate = useServerRefusedPrivate(recipeId, knownPaidFeaturesOf(profile));
    // The confirm's words say what is KNOWN: a failed profile read is "may not", never "won't" (review).
    const makePublic = useMakePublicConfirm({
        state: knownPaidFeaturesOf(profile) ?? 'loading',
        saved: query.data.visibility,
        apply: (done) =>
            setVisibility.mutate({ id: recipeId, visibility: RecipeVisibility.PUBLIC }, { onSuccess: done }),
    });

    // Wait for the viewer profile too before rendering the detail. Owner-gated UI (edit/delete/visibility actions)
    // and the rating mode are derived from `profile` (the viewer id + paid features); rendering before it lands would paint
    // the detail WITHOUT the owner actions and then pop them in — shifting the layout mid-interaction. A signed-out
    // viewer's profile query is disabled, so its `isLoading` is false and this never hangs for a guest.
    if (profile.isLoading) {
        return <RecipeDetailSkeleton label={t.detailLoading} />;
    }

    const recipe = query.data;
    const viewerId = profile.data?.user.id;
    // P4: ONE Viewer value object, built from this platform's identity signal (the profile's app-user id), feeds every
    // gate below through the shared policy predicates — the SAME predicates the web detail container evaluates (D7).
    const viewer = makeViewer({ id: viewerId });
    const viewerIsOwner = isOwner(recipe, viewer);
    // D7: a viewer may clone a PUBLIC recipe they do not own — the SAME `canClone` predicate web now
    // evaluates, closing the drift where web ignored ownership and mobile checked it.
    const viewerCanClone = canClone(recipe, viewer);

    // FR-013 ratings: the viewer may rate a recipe they can read and do NOT own (Sc8) — ownership is the only
    // client-side gate; the backend enforces the rest (Sc8 403, Sc9 not-found). A write's error maps to the
    // honest surface: a not-found (the client's 404 shape) is "not available" (Sc9), never "forbidden".
    const ratingMode = ratingModeFor({ viewerId, ownerId: recipe.ownerId });
    const ratingError = setRating.error ?? deleteRating.error;
    const ratingErrorKind: RecipeRatingError | undefined =
        ratingError === null || ratingError === undefined
            ? undefined
            : isNotFoundError(ratingError)
              ? 'notAvailable'
              : 'generic';
    // §6.1/§6.4: the action row is the primary — Edit recipe for the owner, Save a copy for another cook — and the ⋯
    // menu, whose entries are decided once for both platforms (`detailMenuOf`).
    //
    // ⛔ The delete CONFIRMATION DIALOG does NOT live in the menu: it stays a sibling below, so it survives the menu
    // closing while the dialog is open.
    const menu = detailMenuOf({
        owner: viewerIsOwner,
        isPublic: recipe.visibility === RecipeVisibility.PUBLIC,
        hasMarks: marks.hasMarks,
        offersPrivate: privateGate.offersPrivate,
    });

    const menuItem = (item: DetailMenuItem): ActionMenuItem => {
        switch (item) {
            case 'versions':
                return {
                    id: item,
                    label: detailActions.versionHistory,
                    icon: 'clock',
                    onSelect: () => onViewVersions?.(recipeId),
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

    const moreActions =
        menu.items.length > 0 || menu.destructive !== undefined ? (
            <ActionMenu
                triggerLabel={moreMenu.triggerFor.replace('{title}', recipe.title)}
                title={moreMenu.title}
                closeLabel={moreMenu.close}
                items={menu.items.map(menuItem)}
                appearance="disc"
                {...(menu.destructive === undefined
                    ? {}
                    : {
                          destructiveItem: {
                              id: 'delete',
                              label: detailActions.deleteRecipe,
                              icon: 'trash',
                              onSelect: () => setDeleteOpen(true),
                          },
                      })}
            />
        ) : null;
    const primary = viewerIsOwner ? (
        <Button variant="primary" icon="pencilLine" onPress={() => onEdit?.(recipeId)}>
            {detailActions.editRecipe}
        </Button>
    ) : viewerCanClone ? (
        <Button
            variant="primary"
            icon="copyPlus"
            busy={cloneRecipe.isPending}
            onPress={() => cloneRecipe.mutate(recipeId, { onSuccess: (created) => onCloned?.(created.id) })}
        >
            {detailActions.saveCopy}
        </Button>
    ) : null;
    // The row's primary; Back and ⋯ are discs over the photo, always (§6.1, §3.5). An empty View keeps ⋯ at the end when
    // there is no Back to its start.
    const headerActions = primary ?? undefined;
    const heroControls = (
        <>
            {onBack === undefined ? <View /> : <HeroButton icon="chevronLeft" label={backLabel} onPress={onBack} />}
            {moreActions}
        </>
    );

    // The stars the input pre-selects: the server's `viewerRating` (DA4 — `useSetRecipeRating` /
    // `useDeleteRecipeRating` patch this optimistically in the cache on `onMutate`, so it never flickers back
    // to the pre-write value before the refetch lands). The community `averageRating` stays the displayed score.
    const selectedStars = recipe.viewerRating;

    return (
        <RecipeDetailView
            recipe={recipe}
            viewerIsOwner={viewerIsOwner}
            refreshNotice={refreshNotice}
            unreachableRetry={unreachableRetry}
            headerActions={headerActions}
            heroControls={heroControls}
            onEditSection={() => onEdit?.(recipeId)}
            {...(viewerIsOwner ? { onViewVersions: () => onViewVersions?.(recipeId) } : {})}
            rating={
                // Orchestration picks the render component (B15): the owner sees the read-only aggregate (Sc8);
                // everyone else gets the interactive input. The own-recipe gate lives HERE, not in a mode prop.
                ratingMode === 'own' ? (
                    <RecipeRatingDisplay
                        {...(recipe.averageRating === undefined ? {} : { average: recipe.averageRating })}
                        ratingCount={recipe.ratingCount}
                    />
                ) : (
                    <RecipeRatingInput
                        {...(recipe.averageRating === undefined ? {} : { average: recipe.averageRating })}
                        ratingCount={recipe.ratingCount}
                        {...(selectedStars === undefined ? {} : { selectedStars })}
                        pending={setRating.isPending || deleteRating.isPending}
                        {...(ratingErrorKind === undefined ? {} : { error: ratingErrorKind })}
                        onRate={(stars) => setRating.mutate({ id: recipeId, input: { stars } })}
                        onRemove={() => deleteRating.mutate(recipeId)}
                    />
                )
            }
            scrollFooter={
                <>
                    {/* B17 — a failed visibility change snaps back to the query's value; say so rather than fail silently.
                        The make-public confirm says its own failure inside itself, so it is not said twice. A Private
                        the server refused — the editor's follow-up included — is said in its own words, because trying
                        again cannot succeed. The web page reads the same. */}
                    {serverRefusedPrivate ? (
                        <Text accessibilityRole="alert" style={{ color: theme.colors.dangerText }}>
                            {visibilityCopy.privateRefused[serverRefusedPrivate]}
                        </Text>
                    ) : (
                        setVisibility.error !== null &&
                        !makePublic.dialog.open && (
                            <Text accessibilityRole="alert" style={{ color: theme.colors.dangerText }}>
                                {visibilityCopy.error}
                            </Text>
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
                            open={deleteOpen}
                            deleting={deleteRecipe.isPending}
                            // B17 — a failed delete left the dialog open with no explanation; surface an honest
                            // reason inside it. Cleared on the next attempt (and on recipe switch).
                            error={deleteRecipe.error !== null}
                            onConfirm={() =>
                                deleteRecipe.mutate(recipeId, {
                                    onSuccess: () => {
                                        // The snackbar host sits above the navigator, so this outlives the screen we leave.
                                        snackbar.show({ message: detailActions.recipeDeleted });
                                        onDeleted?.();
                                    },
                                })
                            }
                            onCancel={() => setDeleteOpen(false)}
                        />
                    )}
                </>
            }
        />
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    backButton: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 16,
    },
    backLabel: { fontWeight: '500', fontSize: 15 },
});
