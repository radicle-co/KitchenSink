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
 */
import {
    RecipeNutritionSlot,
    RecipeWidgetLoadingCard,
    recipeHomeWidgetDescriptor,
    type RenderRecipeNutrition,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { Recipe } from '@kitchensink/recipe-core';
import { QueryBoundary } from '@commise/query/boundary';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Suspense, lazy, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';
import { HomeWidgetErrorNotice } from './HomeWidgetErrorNotice.js';

/**
 * The recipe widget's data prop contract (native): the recent recipes (see the module doc), plus the deferred
 * calorie renderer.
 *
 * ⚠️ This is a hand-copied THIRD declaration of a contract that also exists on both widget leaves
 * (`widget/RecipeHomeWidget{,.native}.tsx`) — it exists because the descriptor's loader is deliberately typed
 * `{ default: unknown }` for cross-feature decoupling, so the type has to be re-stated at this boundary. It is
 * the copy most likely to drift; keeping it in step is a known cost, recorded rather than hidden.
 */
interface RecipeHomeWidgetProps {
    recipes?: readonly Recipe[];
    onSelectRecipe?: (id: string) => void;
    renderNutrition?: RenderRecipeNutrition;
}

/** How many recent recipes the widget shows (the widget itself also caps to its own max). */
const RECENT_RECIPE_LIMIT = 4;

/**
 * The recipe widget, code-split through the descriptor's loader seam with `React.lazy`. The loader's
 * `default` is the widget component; it is typed here at the boundary (the contract's loader is intentionally
 * `{ default: unknown }` for cross-feature decoupling).
 */
const RecipeHomeWidget = lazy<ComponentType<RecipeHomeWidgetProps>>(() =>
    recipeHomeWidgetDescriptor
        .load()
        .then((module) => ({ default: module.default as ComponentType<RecipeHomeWidgetProps> })),
);

/** Props for {@link RecipeWidgetSlot}. */
export interface RecipeWidgetSlotProps {
    /** Invoked when the "see all recipes" entry point is activated (the host wires it to navigation). */
    readonly onSeeAllRecipes: () => void;
    /**
     * Invoked with the activated recipe's id when a "Recent recipes" CARD is tapped (the host wires it to
     * navigation). Required, not optional: the shared card leaves render inert without it, and an optional
     * seam here is exactly how the cards silently shipped dead — nothing failed, they just did nothing.
     */
    readonly onSelectRecipe: (id: string) => void;
    /**
     * Invoked when the WIDGET BODY fails to render (see the boundary in the component). Optional only so the
     * happy-path tests need not supply it; the host always does, so a failure is never swallowed (B23/DA9).
     *
     * Takes `unknown`, matching the appShell `ErrorReporter` seam the host wires this to — a throw is not
     * guaranteed to be an `Error`, and narrowing here would force the host to lie about that.
     */
    readonly onWidgetError?: (error: unknown) => void;
}

/**
 * The recipe Home-widget slot: reads the viewer's recent recipes and renders the widget plus its "see all"
 * entry into the recipes surface.
 *
 * @param props - The `onSeeAllRecipes` and `onSelectRecipe` navigation callbacks.
 * @returns The recipe widget with its navigation affordances.
 */
export function RecipeWidgetSlot({
    onSeeAllRecipes,
    onSelectRecipe,
    onWidgetError,
}: RecipeWidgetSlotProps): JSX.Element {
    const { home } = useMessages(mobileMessages);

    return (
        <View style={styles.slot}>
            {/* Scoped to the WIDGET BODY, and deliberately INSIDE this slot rather than left to the host's
                per-widget boundary: the host wraps the whole slot in `<ErrorBoundary fallback={null}>`, so a
                failure that escaped to it would erase the "see all recipes" entry too — the viewer's route out of
                Home would vanish along with the content that failed. Losing the widget's content is acceptable;
                losing the navigation is not. The fallbacks are the shared loading card and failure notice, so the
                wait and the failure look the same as on web (§14). */}
            <QueryBoundary
                loading={<RecipeWidgetLoadingCard />}
                renderError={() => <HomeWidgetErrorNotice />}
                onError={(error) => onWidgetError?.(error)}
            >
                <RecentRecipesWidget onSelectRecipe={onSelectRecipe} onWidgetError={onWidgetError} />
            </QueryBoundary>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={home.seeAllRecipes}
                onPress={onSeeAllRecipes}
                style={styles.seeAll}
            >
                <Text style={styles.seeAllLabel}>{home.seeAllRecipes}</Text>
            </Pressable>
        </View>
    );
}

/**
 * Reads the recent recipes and renders the code-split widget over them. A separate component so the READ suspends
 * inside the slot's {@link QueryBoundary}, while the widget CHUNK keeps a boundary of its own below it.
 *
 * @param props - The card activation and failure-report callbacks.
 * @returns The widget over the viewer's recent recipes.
 */
function RecentRecipesWidget({
    onSelectRecipe,
    onWidgetError,
}: Pick<RecipeWidgetSlotProps, 'onSelectRecipe' | 'onWidgetError'>): JSX.Element {
    const client = useRecipeServiceClient();
    const { data: page } = useSuspenseQuery(recipeQueries(client).list({ pageSize: RECENT_RECIPE_LIMIT }));
    const recipes = page.data;
    // The deferred calorie lookup (ADR-0021 §6) for the recent recipes, started during render so the widget's cards
    // paint over an in-flight request rather than starting one after the first paint.
    const nutritionFor = useRecipeNutritionBatches([recipes.map((recipe) => recipe.id)]);

    return (
        // ⛔ THE CHUNK'S OWN BOUNDARY, separate from the read's. `React.lazy` CACHES a rejected loader — a rejection
        // parks the payload and every later render re-throws the cached result without re-invoking the loader — so
        // a retry could only re-throw. This boundary therefore carries the notice and no retry, while a failed READ
        // is caught above, where a retry would refetch.
        <ErrorBoundary fallback={<HomeWidgetErrorNotice />} onError={(error) => onWidgetError?.(error)}>
            <Suspense fallback={<RecipeWidgetLoadingCard />}>
                {/* The slot owns navigation, not the widget: the presentational card grid reports WHICH recipe was
                    activated, and this layer — the only one with the navigation intent — routes. */}
                <RecipeHomeWidget
                    recipes={recipes}
                    onSelectRecipe={onSelectRecipe}
                    // ONE promise, N slots. `null` ⇒ no batch covers this recipe: render nothing rather than a
                    // boundary with nothing to settle.
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

const styles = StyleSheet.create({
    slot: { gap: 8 },
    seeAll: { alignSelf: 'flex-end', paddingVertical: 4 },
    // `ocean-dark`, not `seafoam`: this is text a reader reads (see the palette JSDoc in `@commise/ui`).
    seeAllLabel: { fontSize: 14, fontWeight: '600', color: palette['ocean-dark'] },
});
