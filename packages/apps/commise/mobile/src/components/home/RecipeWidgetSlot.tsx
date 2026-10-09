/**
 * @module home/RecipeWidgetSlot — the recipe Home widget's host slot (mobile).
 *
 * The Home composition root renders one slot per curated widget id; this is the slot for the recipe
 * (recent-recipes) widget. It owns the two things the generic host cannot: it code-splits the widget module
 * through the descriptor's loader seam via **`React.lazy`** (Metro resolves the loader's
 * `import('./widget/RecipeHomeWidget.js')` to the `.native.tsx` leaf), and it supplies the widget's data —
 * the viewer's recent recipes, read with `useSuspenseQuery` under a {@link QueryBoundary} and passed as the
 * `recipes` PROP, since the native widget is prop-driven (unlike the web entry, which takes a promise). The
 * boundary owns the other two outcomes: the shared loading card while the read is pending, and the widget
 * failure notice when it fails — a failed read is never shown as an empty library.
 *
 * It also owns the widget's navigation entry point ("see all recipes" → the recipes surface), since the
 * presentational widget building blocks carry no navigation. That entry is the viewer's route off Home, so it
 * is deliberately insulated from the widget body: an inner `Suspense` keeps it mounted while the chunk
 * resolves, and an inner `ErrorBoundary` keeps it mounted when the chunk (or the widget) FAILS — see the
 * boundary's own comment for why the host's per-widget boundary is not sufficient on its own.
 *
 * Slice 4 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.2, owner ruling D8): the slot decides the card
 * variant from the container class (compact below 960, full from 960), puts "See all" in the block's heading row —
 * and keeps it on a failure — offers the first run's three ways in when the host wires them, and a failed READ shows
 * Try again, which refetches.
 */
import {
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
import type { Recipe } from '@kitchensink/recipe-core';
import { QueryBoundary } from '@commise/query/boundary';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Suspense, lazy, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

/** The widget's props, as the slot passes them (the module itself is loaded through the descriptor). */
interface RecipeHomeWidgetProps {
    readonly recipes?: readonly Recipe[];
    readonly variant: CardVariant;
    readonly onSelectRecipe?: (id: string) => void;
    readonly seeAll?: RecipeWidgetSeeAll;
    readonly firstRun?: RecipeWidgetFirstRun;
    readonly renderNutrition?: RenderRecipeNutrition;
}

/** Up to four recent recipes (FR-046). Home reads the same page to know its first run. */
export const RECENT_RECIPE_LIMIT = 4;

const RecipeHomeWidget = lazy<ComponentType<RecipeHomeWidgetProps>>(() =>
    recipeHomeWidgetDescriptor
        .load()
        .then((module) => ({ default: module.default as ComponentType<RecipeHomeWidgetProps> })),
);

export interface RecipeWidgetSlotProps {
    /** Invoked when "See all" is activated (the host wires it to navigation). */
    readonly onSeeAllRecipes: () => void;
    /**
     * Invoked with the activated recipe's id when a "Recent recipes" CARD is tapped (the host wires it to
     * navigation). Required, not optional: an optional seam here is exactly how the cards silently shipped dead.
     */
    readonly onSelectRecipe: (id: string) => void;
    /** First run: open an empty editor. With {@link onFindOnDiscover}, the first run offers its ways in. */
    readonly onCreateRecipe?: () => void;
    /** First run: paste an ingredient list. Absent → no paste action. */
    readonly onPasteIngredients?: () => void;
    /** First run: go to Discover. */
    readonly onFindOnDiscover?: () => void;
    /**
     * Invoked when the WIDGET BODY fails to render. Optional only so the happy-path tests need not supply it; the host
     * always does, so a failure is never swallowed (B23/DA9). Takes `unknown`: a throw is not guaranteed to be an Error.
     */
    readonly onWidgetError?: (error: unknown) => void;
}

/**
 * The first run's ways in, when the host wired both the editor and Discover. Pure.
 *
 * @param props - The slot's callbacks.
 * @returns The first run, or `undefined` for none.
 */
function firstRunOf({
    onCreateRecipe,
    onPasteIngredients,
    onFindOnDiscover,
}: Pick<RecipeWidgetSlotProps, 'onCreateRecipe' | 'onPasteIngredients' | 'onFindOnDiscover'>):
    RecipeWidgetFirstRun | undefined {
    if (onCreateRecipe === undefined || onFindOnDiscover === undefined) {
        return undefined;
    }

    return { onCreateRecipe, onFindOnDiscover, ...(onPasteIngredients === undefined ? {} : { onPasteIngredients }) };
}

export function RecipeWidgetSlot(props: RecipeWidgetSlotProps): JSX.Element {
    const { onSeeAllRecipes, onWidgetError } = props;
    const variant = cardVariantOf(useMainContainerClass(), 'grid', 'home');
    const seeAll: RecipeWidgetSeeAll = { onPress: onSeeAllRecipes };

    return (
        // The read's boundary: a failed READ shows Try again (its reset refetches), and keeps "See all", so the route
        // off Home never fails with the content. The widget CHUNK has its own boundary below, with no retry.
        <QueryBoundary
            loading={<RecipeWidgetLoadingCard variant={variant} seeAll={seeAll} />}
            renderError={({ resetErrorBoundary }) => (
                <RecipeWidgetLoadError onRetry={resetErrorBoundary} seeAll={seeAll} />
            )}
            onError={(error) => onWidgetError?.(error)}
        >
            <RecentRecipesWidget {...props} variant={variant} seeAll={seeAll} />
        </QueryBoundary>
    );
}

/**
 * Reads the recent recipes and renders the code-split widget over them. A separate component so the READ suspends
 * inside the slot's {@link QueryBoundary}, while the widget CHUNK keeps a boundary of its own below it.
 *
 * @param props - The slot's callbacks, the decided variant and the "See all".
 * @returns The widget over the viewer's recent recipes.
 */
function RecentRecipesWidget({
    onSelectRecipe,
    onWidgetError,
    variant,
    seeAll,
    ...firstRun
}: RecipeWidgetSlotProps & { readonly variant: CardVariant; readonly seeAll: RecipeWidgetSeeAll }): JSX.Element {
    const client = useRecipeServiceClient();
    const { data: page } = useSuspenseQuery(recipeQueries(client).list({ pageSize: RECENT_RECIPE_LIMIT }));
    const recipes = page.data;
    // The deferred calorie lookup (ADR-0021 §6), started during render so the cards paint over an in-flight request.
    const nutritionFor = useRecipeNutritionBatches([recipes.map((recipe) => recipe.id)]);
    const ways = firstRunOf(firstRun);

    return (
        // ⛔ THE CHUNK'S OWN BOUNDARY. `React.lazy` CACHES a rejected loader, so a retry could only re-throw: this
        // boundary carries the notice and no retry, while a failed READ is caught above, where a retry refetches.
        <ErrorBoundary fallback={<RecipeWidgetLoadError seeAll={seeAll} />} onError={(error) => onWidgetError?.(error)}>
            <Suspense fallback={<RecipeWidgetLoadingCard variant={variant} seeAll={seeAll} />}>
                <RecipeHomeWidget
                    recipes={recipes}
                    variant={variant}
                    onSelectRecipe={onSelectRecipe}
                    seeAll={seeAll}
                    {...(ways === undefined ? {} : { firstRun: ways })}
                    // ONE promise, N slots. `null` ⇒ no batch covers this recipe: render nothing.
                    renderNutrition={(recipeId) => {
                        const batch = nutritionFor(recipeId);

                        return batch === null ? null : (
                            <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />
                        );
                    }}
                />
            </Suspense>
        </ErrorBoundary>
    );
}
