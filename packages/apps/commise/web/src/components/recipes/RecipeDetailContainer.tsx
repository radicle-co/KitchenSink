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
 * recipe into local state. The mutations are owned by the recipe-service hooks, which invalidate the relevant caches;
 * the controller wires them and this container hands it the navigation after a clone or a delete.
 *
 * Every DECISION the page makes — who the viewer is, the ownership and clone gates, the Private gate, the visibility
 * notice, the ⋯ menu, the rating block and the owner dialogs — is `useRecipeDetailController`
 * (`@commise/features-recipes/detail`), the SAME hook the mobile screen runs, so the two platforms cannot diverge on a
 * gate (this closes D7). The viewer is the session's `external_id` claim (the recipe service's owner key) and, when the
 * claim is absent, the profile's `user.id` (owner ruling 2026-10-16). This file keeps what is the web's own: the read,
 * the layout, the router and the address that carries a finished editor's refusal.
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
    RecipeDetailView,
    editorMessages,
    FINISHED_OUTCOME_PARAM,
    finishedNoticeOf,
    isUnreachableRecovery,
    parseFinishedParam,
    recipeActionMessages,
    recipeMessages,
} from '@commise/features-recipes';
import { RecipeDetailDialogs, RecipeDetailRating, useRecipeDetailController } from '@commise/features-recipes/detail';
import { useMessages } from '@commise/i18n/react';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { ActionMenu } from '@commise/ui/action-menu';
import { Button, buttonSurfaceClass, GHOST_EDGE_CLASS } from '@commise/ui/button';
import { HeroButton } from '@commise/ui/hero-button';
import { Icon } from '@commise/ui/icon';
import { ScrollHost, useScrollHost } from '@commise/ui/scroll-host';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState, type ComponentProps, type FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { dataSourcesHref } from '@/components/app/dataSourcesHref';
import { RecipeDetailRouteLoading } from '@/components/recipes/RecipeDetailRouteLoading';
import { RecipeReadError } from '@/components/recipes/RecipeReadError';
import { recipesAfterDeleteHref } from '@/components/recipes/recipesAfterDeleteHref';
import { useAddressNotice } from '@/hooks/useAddressNotice';
import { useUserProfile } from '@/hooks/useUserProfile';

/** Props for {@link RecipeDetailContainer}. */
export interface RecipeDetailContainerProps {
    /** The recipe id from the `[id]` route segment. */
    readonly id: string;
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
                <RecipeReadError error={error} onRetry={resetErrorBoundary} />
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
    const { detail: detailCopy } = useMessages(recipeMessages);
    const { detailActions } = useMessages(recipeActionMessages);
    const editorCopy = useMessages(editorMessages);

    // E8: the editor finished and navigated here with `?done=<outcome>[.<refusal>]`; say how it finished once. The
    // parameter is the reader's to forge: only the exact spellings count.
    //
    // A refusal in it (the editor withheld a Private the server would refuse) is not said by the snackbar. The same effect
    // keeps it as a CLAIM, for this recipe, because it is the only place that sees the value before the parameter leaves
    // the address, and it runs after the page mounted, so the live region below is filled one render after it exists.
    // ⛔ A claim is not a fact: `visibilityNoticeOf` says it only when the owner's own public recipe and the profile agree.
    const [finishRefusalFor, setFinishRefusalFor] = useState<string | undefined>(undefined);
    const keepFinishRefusal = useCallback(
        (value: string): void => {
            if (parseFinishedParam(value)?.privateRefused !== undefined) {
                setFinishRefusalFor(id);
            }
        },
        [id],
    );
    useAddressNotice(
        FINISHED_OUTCOME_PARAM,
        (value) => {
            const finished = parseFinishedParam(value);

            return finished === undefined ? undefined : finishedNoticeOf(finished, editorCopy);
        },
        keepFinishRefusal,
    );

    const recipe = query.data;
    const versionsHref = `/${locale}/recipes/${id}/versions`;
    // Everything the page decides, once for both apps: the viewer (the session claim, else the profile), the Private
    // gate, the visibility notice, the primary, the ⋯ menu, the rating block and the owner dialogs. This shell draws it.
    const page = useRecipeDetailController({
        id,
        recipe,
        sessionClaims,
        profile,
        finishRefused: finishRefusalFor === id,
        nav: {
            onVersions: () => router.push(versionsHref as Route),
            // A copy needs a real edit before it can be published (FR-005b), so it opens in the editor.
            onCloned: (createdId) => router.push(`/${locale}/recipes/${createdId}/edit` as Route),
            // "Recipe deleted" is said by the page this lands on: a snackbar raised here would die with this page's
            // shell (`recipesAfterDeleteHref`).
            onDeleted: () => router.push(recipesAfterDeleteHref(locale) as Route),
        },
    });

    if (!page.ready) {
        // Nothing names the viewer yet and the profile may: hold the page's own loading state rather than draw a
        // non-owner page of the cook's recipe and correct it.
        return <RecipeDetailRouteLoading />;
    }

    // The ⋯ menu is drawn twice — a disc over the hero below 840, a plain trigger in the action row from 840 — so it is
    // built by appearance. Each instance keeps its own open state, and the hidden one is `display: none`, so it is
    // neither focusable nor announced.
    const moreActions = (appearance: 'plain' | 'disc') =>
        page.menu === undefined ? null : <ActionMenu {...page.menu} appearance={appearance} />;
    // §6.1: the action row is the primary — Edit recipe for the owner, Save a copy for another cook. The two NAVIGATIONS
    // stay real links: a `<button onClick={router.push}>` would lose the link role, ⌘-click and open-in-new-tab.
    const primary =
        page.primary === 'edit' ? (
            <Link href={`/${locale}/recipes/${id}/edit` as Route} className={buttonSurfaceClass('primary')}>
                <Icon name="pencilLine" size={20} />
                {detailActions.editRecipe}
            </Link>
        ) : page.primary === 'saveCopy' ? (
            <Button icon="copyPlus" busy={page.clone.pending} onPress={page.clone.run}>
                {detailActions.saveCopy}
            </Button>
        ) : null;
    const headerActions =
        primary === null && page.menu === undefined ? undefined : (
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
                    versionsHref={page.viewerIsOwner ? versionsHref : undefined}
                    viewerIsOwner={page.viewerIsOwner}
                    {...(page.visibilityNotice === undefined ? {} : { visibilityNotice: page.visibilityNotice })}
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
                            {page.menu === undefined ? null : <span className="nav:hidden">{moreActions('disc')}</span>}
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
                    rating={<RecipeDetailRating {...page.rating} />}
                />
            </ScrollHost>

            <RecipeDetailDialogs {...page.dialogs} />
        </>
    );
};
