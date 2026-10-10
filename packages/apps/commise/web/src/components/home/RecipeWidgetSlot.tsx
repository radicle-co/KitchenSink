'use client';

/**
 * @module home/RecipeWidgetSlot — the recipe Home widget's host slot (web).
 *
 * The Home composition root renders one slot per curated widget id; this is the slot for the recipe
 * (recent-recipes) widget. It owns what the generic host cannot: it code-splits the widget module through the
 * descriptor's loader seam via **`next/dynamic`**, and it supplies the widget's data — the viewer's recent recipes as
 * a **promise** the slot starts and hands down, so the widget streams under its own `<Suspense>`.
 *
 * It also owns the block's navigation and presentation (`docs/design/uiOverhaul/buildSpec.md` §4.2, owner ruling D8):
 * the card variant from the container class of `<main>` (compact below 960, full from 960), "See all" in the block's
 * heading row — kept on a failure, so the route to My recipes never fails with the content — the first run's three
 * ways in, and the routes each card leads to. A failed READ shows Try again, which starts a fresh read.
 *
 * Finally it owns the DEFERRED CALORIE LOOKUP (ADR-0021 §6) — see {@link RecipeWidgetNutritionContainer}.
 */
import {
    MAX_RECENT_RECIPES,
    RecipeNutritionSlot,
    RecipeWidgetLoadError,
    RecipeWidgetLoadingCard,
    cardVariantOf,
    recipeHomeWidgetDescriptor,
    useMainContainerClass,
    type CardVariant,
    type RecipeWidgetFirstRun,
    type RecipeWidgetSeeAll,
    type RenderRecipeNutrition,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useLocale } from '@commise/i18n/react';
import type { Recipe } from '@kitchensink/recipe-core';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Suspense, use, useMemo, useState, type ComponentType, type FC, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { pasteIngredientsHref } from '@/components/recipes/pasteIngredientsHref';

/** The widget's props, as the slot passes them (the module itself is loaded through the descriptor). */
interface RecipeHomeWidgetProps {
    readonly recipesPromise: Promise<readonly Recipe[]>;
    readonly variant: CardVariant;
    readonly onSelectRecipe?: (id: string) => void;
    readonly hrefOf?: (id: string) => string;
    readonly seeAll?: RecipeWidgetSeeAll;
    readonly firstRun?: RecipeWidgetFirstRun;
    readonly renderNutrition?: RenderRecipeNutrition;
}

/** Up to four recent recipes (FR-046). Home reads the same page to know its first run. */
export const RECENT_RECIPE_LIMIT = 4;

/** The code-split widget, client-only (it reads the browser's session). */
const RecipeHomeWidget = dynamic<RecipeHomeWidgetProps>(
    () =>
        recipeHomeWidgetDescriptor
            .load()
            .then((module) => ({ default: module.default as ComponentType<RecipeHomeWidgetProps> })),
    { ssr: false },
);

/**
 * Starts the deferred calorie batch for the recipes the widget will show — a component of its own because the batch
 * needs the recipes' ids, which exist only once the promise has resolved (`use`), and suspending there is this
 * component's job, not the widget's.
 *
 * @param props - The widget's props.
 * @returns The widget with its calorie slot.
 */
const RecipeWidgetNutritionContainer: FC<RecipeHomeWidgetProps> = (props) => {
    const recipes = use(props.recipesPromise);
    const nutritionFor = useRecipeNutritionBatches([recipes.slice(0, MAX_RECENT_RECIPES).map((recipe) => recipe.id)]);

    return (
        // ⛔ THE WIDGET'S OWN BOUNDARY, with no retry. `next/dynamic` builds its lazy proxy once at module scope and a
        // rejected chunk stays rejected, so a Try again here could only re-throw and read as a dead button. A failed
        // READ (the promise above) is caught by the slot's boundary instead, where a retry starts a fresh read.
        <ErrorBoundary
            fallback={<RecipeWidgetLoadError {...(props.seeAll === undefined ? {} : { seeAll: props.seeAll })} />}
        >
            <RecipeHomeWidget
                {...props}
                renderNutrition={(recipeId) => {
                    const batch = nutritionFor(recipeId);

                    return batch === null ? null : (
                        <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />
                    );
                }}
            />
        </ErrorBoundary>
    );
};

/**
 * The recipe Home widget's slot.
 *
 * @returns The block, with its loading and failure states.
 */
export function RecipeWidgetSlot(): JSX.Element {
    const client = useRecipeServiceClient();
    const locale = useLocale();
    const router = useRouter();
    const queryClient = useQueryClient();
    const variant = cardVariantOf(useMainContainerClass(), 'grid', 'home');
    // A new attempt is a new read: Try again bumps it, so the promise below is started afresh.
    const [attempt, setAttempt] = useState(0);
    const go = (path: string) => router.push(path as Route);
    const seeAll: RecipeWidgetSeeAll = { href: `/${locale}/recipes`, onPress: () => go(`/${locale}/recipes`) };
    const firstRun: RecipeWidgetFirstRun = {
        onCreateRecipe: () => go(`/${locale}/recipes/new`),
        // Paste lives in the editor's Ingredients section (slice 8): the new editor opens there with its sheet up.
        onPasteIngredients: () => go(pasteIngredientsHref(locale)),
        onFindOnDiscover: () => go(`/${locale}/discover`),
        discoverHref: `/${locale}/discover`,
    };

    const recipesPromise = useMemo<Promise<readonly Recipe[]>>(() => {
        const read = recipeQueries(client).list({ pageSize: RECENT_RECIPE_LIMIT });

        if (typeof window === 'undefined') {
            return Promise.resolve<readonly Recipe[]>([]);
        }

        // A retry must not be answered from the failed entry: drop it, then read afresh.
        if (attempt > 0) {
            queryClient.removeQueries({ queryKey: read.queryKey, exact: true });
        }

        return queryClient.ensureQueryData(read).then((page) => page.data);
    }, [client, queryClient, attempt]);

    return (
        // The READ's boundary, inside the slot: a failed read shows the block's load error with Try again, and keeps
        // "See all", rather than escaping to the host's boundary and taking the route off Home with it.
        <ErrorBoundary
            resetKeys={[attempt]}
            fallbackRender={() => <RecipeWidgetLoadError onRetry={() => setAttempt((n) => n + 1)} seeAll={seeAll} />}
        >
            <Suspense fallback={<RecipeWidgetLoadingCard variant={variant} seeAll={seeAll} />}>
                <RecipeWidgetNutritionContainer
                    recipesPromise={recipesPromise}
                    variant={variant}
                    onSelectRecipe={(id) => go(`/${locale}/recipes/${id}`)}
                    hrefOf={(id) => `/${locale}/recipes/${id}`}
                    seeAll={seeAll}
                    firstRun={firstRun}
                />
            </Suspense>
        </ErrorBoundary>
    );
}
