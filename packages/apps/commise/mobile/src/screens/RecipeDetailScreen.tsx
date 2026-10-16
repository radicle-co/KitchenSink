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
 * Every DECISION the page makes — who the viewer is, the ownership and clone gates, the Private gate, the visibility
 * notice, the ⋯ menu, the rating block and the owner dialogs — is `useRecipeDetailController`
 * (`@commise/features-recipes/detail`), the SAME hook the web container runs, so the two platforms cannot diverge on a
 * gate (this closes D7). The viewer is the session's `external_id` claim and, when the claim is absent, the profile's
 * `user.id` (owner ruling 2026-10-16); with the claim in hand the body shows without waiting for the profile. Every
 * mutation is reported upward so the navigator can route (back to the list after delete, to the new recipe after clone).
 * Remote state stays in the query cache — this screen derives its view state from it.
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
    RecipeDetailSkeleton,
    RecipeDetailView,
    isUnreachableRecovery,
    recipeMessages,
    recipeActionMessages,
} from '@commise/features-recipes';
import { RecipeDetailDialogs, RecipeDetailRating, useRecipeDetailController } from '@commise/features-recipes/detail';
import { useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { ActionMenu } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { HeroButton } from '@commise/ui/hero-button';
import { Icon } from '@commise/ui/icon';
import { useTheme } from '@commise/ui/theme';
import { useSnackbar } from '@commise/ui/snackbar';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';
import { useSessionClaims } from '../hooks/useSessionClaims.js';
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
    /**
     * The editor finished and reported that it withheld a Private the server would refuse (the route's param). This is
     * a CLAIM, not a fact: the sentence shows only for the owner of a public recipe whose profile refuses Private
     * (`visibilityNoticeOf`).
     */
    readonly refusalArrived?: boolean;
    /** The route kept the claim, after {@link RecipeDetailScreenProps.onFinishRefusalSeen}; the sentence follows it. */
    readonly finishRefused?: boolean;
    /**
     * Called once the BODY has mounted with the claim waiting, never while the skeleton shows: the live region must
     * exist, empty, before its text arrives, because Android does not reliably speak a region that mounts with its text.
     * The route keeps the claim and clears its param.
     */
    readonly onFinishRefusalSeen?: () => void;
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
    // The route below THIS screen, found by its own key: `state.index` is the FOCUSED route, which is a different
    // screen whenever this page re-renders while covered (Save a copy pushes the copy and its editor on top).
    const ownKey = useContext(NavigationRouteContext)?.key;
    const routes = navigation?.getState()?.routes ?? [];
    const own = routes.findIndex((route) => route.key === ownKey);
    const previous = own > 0 ? routes[own - 1]?.name : undefined;

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
    refusalArrived,
    finishRefused,
    onFinishRefusalSeen,
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
    const { detailActions } = useMessages(recipeActionMessages);
    const { recipes: t } = useMessages(mobileMessages);
    const snackbar = useSnackbar();
    const backLabel = useBackLabel();
    const recipe = query.data;
    const sessionClaims = useSessionClaims();
    const profile = useUserProfile();
    // Everything the page decides, once for both apps: the viewer (the session claim, else the profile), the Private
    // gate, the visibility notice, the primary, the ⋯ menu, the rating block and the owner dialogs. This shell draws it.
    const page = useRecipeDetailController({
        id: recipeId,
        recipe,
        sessionClaims,
        profile,
        finishRefused: finishRefused === true,
        ...(refusalArrived === undefined ? {} : { refusalArrived }),
        ...(onFinishRefusalSeen === undefined ? {} : { onFinishRefusalSeen }),
        nav: {
            onVersions: () => onViewVersions?.(recipeId),
            onCloned: (createdId) => onCloned?.(createdId),
            onDeleted: () => {
                // The snackbar host sits above the navigator, so this outlives the screen we leave.
                snackbar.show({ message: detailActions.recipeDeleted });
                onDeleted?.();
            },
        },
    });

    // Nothing names the viewer yet and the profile may: hold the skeleton rather than paint the detail WITHOUT the owner
    // actions and pop them in — a layout shift that makes a fast tapper race a moving target. With the session claim in
    // hand the body shows at once (owner ruling 2026-10-16). A signed-out viewer's profile query is disabled, so its
    // `isLoading` is false and this never hangs for a guest.
    if (!page.ready) {
        return <RecipeDetailSkeleton label={t.detailLoading} />;
    }

    // The row's primary; Back and ⋯ are discs over the photo, always (§6.1, §3.5). An empty View keeps ⋯ at the end when
    // there is no Back to its start.
    const primary =
        page.primary === 'edit' ? (
            <Button variant="primary" icon="pencilLine" onPress={() => onEdit?.(recipeId)}>
                {detailActions.editRecipe}
            </Button>
        ) : page.primary === 'saveCopy' ? (
            <Button variant="primary" icon="copyPlus" busy={page.clone.pending} onPress={page.clone.run}>
                {detailActions.saveCopy}
            </Button>
        ) : undefined;
    const heroControls = (
        <>
            {onBack === undefined ? <View /> : <HeroButton icon="chevronLeft" label={backLabel} onPress={onBack} />}
            {page.menu === undefined ? null : <ActionMenu {...page.menu} appearance="disc" />}
        </>
    );

    return (
        <RecipeDetailView
            recipe={recipe}
            viewerIsOwner={page.viewerIsOwner}
            {...(page.visibilityNotice === undefined ? {} : { visibilityNotice: page.visibilityNotice })}
            refreshNotice={refreshNotice}
            unreachableRetry={unreachableRetry}
            headerActions={primary}
            heroControls={heroControls}
            onEditSection={() => onEdit?.(recipeId)}
            {...(page.viewerIsOwner ? { onViewVersions: () => onViewVersions?.(recipeId) } : {})}
            rating={<RecipeDetailRating {...page.rating} />}
            scrollFooter={<RecipeDetailDialogs {...page.dialogs} />}
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
