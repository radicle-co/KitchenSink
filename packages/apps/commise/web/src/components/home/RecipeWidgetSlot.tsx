'use client';

/**
 * @module home/RecipeWidgetSlot — the recipe Home widget's host slot (web).
 *
 * The Home composition root renders one slot per curated widget id; this is the slot for the recipe
 * (recent-recipes) widget. It owns the two things the generic host cannot: it code-splits the widget module
 * through the descriptor's loader seam via **`next/dynamic`** (RSC-compatible, per FR-046 — not
 * `React.lazy`), and it supplies the widget's data prop — the viewer's recent recipes as a **promise** the
 * slot starts (via the shared authenticated {@link useRecipeServiceClient}) and hands down, so the widget
 * streams under its own `<Suspense>` instead of branching on a loading flag.
 *
 * It also owns the widget's navigation entry point ("see all recipes" → the recipes surface), since the
 * presentational widget building blocks carry no navigation.
 *
 * Finally it owns the DEFERRED CALORIE LOOKUP (ADR-0021 §6) — see {@link RecipeWidgetNutritionContainer} for
 * why that needs a component of its own rather than a few lines in this one.
 */
import {
    MAX_RECENT_RECIPES,
    RecipeNutritionSlot,
    RecipeWidgetLoadingCard,
    recipeHomeWidgetDescriptor,
    type RenderRecipeNutrition,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { Recipe } from '@kitchensink/recipe-core';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, use, useMemo, type ComponentType, type FC, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { webMessages } from '@/i18n/messages';

import { HomeWidgetErrorNotice } from './HomeWidgetErrorNotice';

/**
 * The recipe widget's props at this boundary — its recent recipes as a promise (see the module doc), the
 * card-activation navigation seam this slot fulfils, and the deferred calorie renderer.
 *
 * ⚠️ This is a hand-copied declaration of a contract that also exists on the widget leaf
 * (`widget/RecipeHomeWidget.tsx`) — it exists because the descriptor's loader is deliberately typed
 * `{ default: unknown }` for cross-feature decoupling, so the type has to be re-stated at this boundary. The
 * mobile slot carries the same note over the same copy; keeping the set in step is a known cost, recorded
 * rather than hidden.
 */
interface RecipeHomeWidgetProps {
    recipesPromise: Promise<readonly Recipe[]>;
    onSelectRecipe?: (id: string) => void;
    renderNutrition?: RenderRecipeNutrition;
}

/** How many recent recipes the widget shows (the widget itself also caps to its own max). */
const RECENT_RECIPE_LIMIT = 4;

/**
 * The recipe widget, code-split through the descriptor's loader seam with `next/dynamic`. `ssr: false`
 * because the whole Home surface is client-rendered (it needs the viewer's auth token for tier + recipes),
 * so there is no server pass to hydrate. The loader's `default` is the widget component; it is typed here at
 * the boundary (the contract's loader is intentionally `{ default: unknown }` for cross-feature decoupling).
 */
const RecipeHomeWidget = dynamic<RecipeHomeWidgetProps>(
    () =>
        recipeHomeWidgetDescriptor
            .load()
            .then((module) => ({ default: module.default as ComponentType<RecipeHomeWidgetProps> })),
    { ssr: false },
);

/** Props for {@link RecipeWidgetNutritionContainer}. */
interface RecipeWidgetNutritionContainerProps {
    /** The recent-recipes read the slot started — the SAME object the widget then suspends on. */
    readonly recipesPromise: Promise<readonly Recipe[]>;
    /** Forwarded to the widget: the card-activation seam the slot routes. */
    readonly onSelectRecipe: (id: string) => void;
}

/**
 * The deferred calorie lookup's orchestration layer: resolves the recent recipes, turns the ones the widget
 * will actually PAINT into ONE nutrition batch, and hands the widget a per-card render prop over it
 * (ADR-0021 §6).
 *
 * ⛔ WHY THIS IS A COMPONENT AND NOT THREE LINES IN THE SLOT. `useRecipeNutritionBatches` needs the recipe
 * IDS synchronously, and the slot has only a PROMISE — mobile's twin reads `useRecipes`, a TanStack query, so
 * its ids are simply in hand. Resolving that promise means suspending, and only a component below a
 * `<Suspense>` may suspend. The two shapes this deliberately is NOT:
 *
 *  - **The hook inside the widget leaf.** The leaf is a pure `props → JSX` render component shared with
 *    mobile; giving it the hook would make it require a `QueryClientProvider` (which its own harnesses do not
 *    provide) and would break the leaf/host split both platforms otherwise share. The render prop exists
 *    precisely so the HOST owns the lookup.
 *  - **Converging this slot onto `useRecipes` to match mobile.** Tempting and more symmetric, but the web
 *    leaf's contract is a PROMISE, so the query's data would have to be re-wrapped into one — and a promise
 *    manufactured per render re-suspends the widget on every render. The `useMemo` below already owns that
 *    hazard, with reasoning recorded; trading it for a subtler version of itself is not an improvement.
 *
 * It re-`use()`s the same promise the widget does, which costs nothing: `use()` memoizes per PROMISE, so the
 * widget's own `<Suspense>` finds it already settled and never falls back. That inner boundary is not dead —
 * it is the leaf's published contract for any host handing it a pending promise — it simply never fires from
 * HERE, because this container resolved first.
 */
const RecipeWidgetNutritionContainer: FC<RecipeWidgetNutritionContainerProps> = ({
    recipesPromise,
    onSelectRecipe,
}) => {
    const recipes = use(recipesPromise);
    // The ids the widget SHOWS, capped exactly as the widget caps its grid. Batching the whole page instead
    // would be invisible on screen and would pay, on an endpoint priced by id count, for answers no card
    // renders. The array is rebuilt every render on purpose: the hook re-batches on the page's SIGNATURE, not
    // on array identity, so a stable reference here would buy nothing.
    const nutritionFor = useRecipeNutritionBatches([recipes.slice(0, MAX_RECENT_RECIPES).map((recipe) => recipe.id)]);

    return (
        <RecipeHomeWidget
            recipesPromise={recipesPromise}
            onSelectRecipe={onSelectRecipe}
            // ONE promise, N slots. `null` ⇒ no batch covers this recipe: render nothing rather than mount a
            // boundary with no promise to settle (a skeleton that would never come down).
            renderNutrition={(recipeId) => {
                const batch = nutritionFor(recipeId);

                return batch === null ? null : (
                    <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />
                );
            }}
        />
    );
};

/**
 * The recipe Home-widget slot: starts the recent-recipes fetch as a stable promise and renders the widget
 * plus its "see all" entry into the recipes surface.
 *
 * @returns The recipe widget with its navigation affordance.
 */
export function RecipeWidgetSlot(): JSX.Element {
    const client = useRecipeServiceClient();
    const locale = useLocale();
    const router = useRouter();
    const { home } = useMessages(webMessages);

    // One stable promise per client instance, so neither the nutrition container's `<Suspense>` nor the
    // widget's re-suspends on every host re-render (a fresh promise each render would reset both boundaries
    // and flash the skeleton back over a settled card).
    //
    // The viewer's Clerk token is client-only, so the fetch must not run during SSR: the request would be
    // wasted, and a server-side rejection — the token being unavailable — is not something the browser tree
    // ever gets a chance to retry. Resolve to empty on the server; the real fetch runs once, in the browser.
    //
    // ⚠️ The half of this reasoning that CHANGED (2026-08-16): it used to add "nothing renders the widget
    // server-side to consume (and thus catch) the promise, so a rejection would be UNHANDLED". That was true
    // while the only consumer was the `ssr: false` widget; `RecipeWidgetNutritionContainer` is a plain
    // component, so the promise IS consumed — and its rejection caught by the boundary above — on the server
    // too. The guard stays because its FIRST reason (no token server-side) stands on its own.
    const recipesPromise = useMemo<Promise<readonly Recipe[]>>(
        () =>
            typeof window === 'undefined'
                ? Promise.resolve<readonly Recipe[]>([])
                : client.listRecipes({ pageSize: RECENT_RECIPE_LIMIT }).then((page) => page.data),
        [client],
    );

    return (
        <div className="flex flex-col gap-2">
            {/* Scoped to the WIDGET BODY, and deliberately INSIDE this slot rather than left to the host's
                per-widget boundary. The host wraps the whole slot, so without this inner boundary a
                widget-body throw (failed chunk, bad recipe record) replaced the "see all recipes" LINK with
                the widget-error text — the viewer's route out of Home disappeared along with the content that
                failed. Losing the widget's content is acceptable; losing the navigation is not. The mobile
                slot carries the same inner boundary, so both platforms degrade identically (FR-044).

                The fallback is the shared {@link HomeWidgetErrorNotice} — the same stand-in the host boundary
                renders, so the copy, the muted treatment, and the `status` announcement have ONE definition and
                cannot drift between the two boundaries. It carries NO "try again" control, and that is
                deliberate: `RecipeHomeWidget` is built once at MODULE scope, and React's `lazyInitializer`
                invokes the loader only while the payload is Uninitialized — a rejection parks it at
                `_status = 2` and every later render bare-throws the cached `_result` WITHOUT re-invoking the
                loader. Resetting this boundary would therefore re-throw synchronously against the same object
                and the button would look dead. A real retry would have to mint a NEW lazy proxy (a generation
                counter keying the dynamic import), worth doing only once we know what actually throws here. */}
            <ErrorBoundary fallback={<HomeWidgetErrorNotice />}>
                {/* ⛔ THIS BOUNDARY IS INSIDE THE SLOT, NOT THE HOST'S. `HomeWidgetSurface` already wraps every
                    bespoke slot in `<Suspense fallback={null}>` — but that one is OUTSIDE this whole `<div>`,
                    so letting the container suspend up to it would blank the "see all recipes" LINK below for
                    as long as the recipes are in flight. Same argument as the `ErrorBoundary` above, and the
                    same conclusion: the widget's CONTENT may wait (or fail); the viewer's route off Home may
                    not. It also sits INSIDE the error boundary, so a REJECTED recipes read still lands on the
                    localized notice rather than escaping to the host.

                    The fallback is the shared {@link RecipeWidgetLoadingCard} — the very card the widget's own
                    Suspense would have rendered — so the wait looks identical whether it is this boundary or
                    the widget's that is showing it, and neither can be restyled without the other. */}
                <Suspense fallback={<RecipeWidgetLoadingCard />}>
                    {/* The slot owns navigation, not the widget: the presentational card grid reports which
                        recipe was activated, and this layer — the only one that knows the App Router and the
                        locale prefix — routes to the recipe detail. */}
                    <RecipeWidgetNutritionContainer
                        recipesPromise={recipesPromise}
                        onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
                    />
                </Suspense>
            </ErrorBoundary>
            <Link
                href={`/${locale}/recipes` as Route}
                aria-label={home.surface.seeAllRecipes}
                // `ocean-dark`, not `seafoam`: this is text a reader reads (see the palette JSDoc in `@commise/ui`).
                className="self-end text-sm font-medium text-ocean-dark"
            >
                {home.surface.seeAllRecipes}
            </Link>
        </div>
    );
}
