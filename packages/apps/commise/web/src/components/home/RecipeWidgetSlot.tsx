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
 */
import { recipeHomeWidgetDescriptor } from '@commise/features-recipes';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { Recipe } from '@kitchensink/recipe-core';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { webMessages } from '@/i18n/messages';

/**
 * The recipe widget's props at this boundary — its recent recipes as a promise (see the module doc) plus the
 * card-activation navigation seam this slot fulfils.
 */
interface RecipeHomeWidgetProps {
    recipesPromise: Promise<readonly Recipe[]>;
    onSelectRecipe?: (id: string) => void;
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

    // One stable promise per client instance, so the widget's `<Suspense>` does not re-suspend on every
    // host re-render (a fresh promise each render would reset the boundary and flash the skeleton).
    //
    // `RecipeHomeWidget` is `ssr: false` and the viewer's Clerk token is client-only, so the fetch must not
    // run during SSR: nothing renders the widget server-side to consume (and thus catch) the promise, so a
    // server-side rejection — e.g. the token being unavailable — would surface as an *unhandled* rejection
    // and the request would be wasted regardless. Resolve to empty on the server; the real fetch runs once,
    // in the browser, where the widget actually mounts.
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
                slot carries the same inner boundary, so both platforms degrade identically (FR-044). */}
            <ErrorBoundary fallback={<p className="text-body-sm text-slate">{home.surface.widgetError}</p>}>
                {/* The slot owns navigation, not the widget: the presentational card grid reports which recipe
                    was activated, and this layer — the only one that knows the App Router and the locale
                    prefix — routes to the recipe detail. */}
                <RecipeHomeWidget
                    recipesPromise={recipesPromise}
                    onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
                />
            </ErrorBoundary>
            <Link
                href={`/${locale}/recipes` as Route}
                aria-label={home.surface.seeAllRecipes}
                className="self-end text-sm font-medium text-seafoam"
            >
                {home.surface.seeAllRecipes}
            </Link>
        </div>
    );
}
