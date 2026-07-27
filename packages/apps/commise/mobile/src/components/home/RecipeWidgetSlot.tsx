/**
 * @module home/RecipeWidgetSlot — the recipe Home widget's host slot (mobile).
 *
 * The Home composition root renders one slot per curated widget id; this is the slot for the recipe
 * (recent-recipes) widget. It owns the two things the generic host cannot: it code-splits the widget module
 * through the descriptor's loader seam via **`React.lazy`** (Metro resolves the loader's
 * `import('./widget/RecipeHomeWidget.js')` to the `.native.tsx` leaf), and it supplies the widget's data —
 * the viewer's recent recipes read from the shared `useRecipes` query and passed as PROPS (`recipes` +
 * `isLoading`), since the native widget is prop-driven (unlike the web entry, which takes a promise).
 *
 * It also owns the widget's navigation entry point ("see all recipes" → the recipes surface), since the
 * presentational widget building blocks carry no navigation. An inner `Suspense` covers only the lazily
 * loaded widget chunk, so the "see all" affordance stays mounted while that chunk resolves.
 */
import { recipeHomeWidgetDescriptor } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { Recipe } from '@kitchensink/recipe-core';
import { useRecipes } from '@kitchensink/recipe-service-client/hooks';
import { Suspense, lazy, type ComponentType, type JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';

/** The recipe widget's data prop contract (native): recent recipes + a loading flag (see the module doc). */
interface RecipeHomeWidgetProps {
    recipes?: readonly Recipe[];
    isLoading?: boolean;
    onSelectRecipe?: (id: string) => void;
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
}

/**
 * The recipe Home-widget slot: reads the viewer's recent recipes and renders the widget plus its "see all"
 * entry into the recipes surface.
 *
 * @param props - The `onSeeAllRecipes` and `onSelectRecipe` navigation callbacks.
 * @returns The recipe widget with its navigation affordances.
 */
export function RecipeWidgetSlot({ onSeeAllRecipes, onSelectRecipe }: RecipeWidgetSlotProps): JSX.Element {
    const { home } = useMessages(mobileMessages);
    const query = useRecipes({ pageSize: RECENT_RECIPE_LIMIT });

    const recipes = query.data?.data ?? [];
    const isLoading = query.isLoading;

    return (
        <View style={styles.slot}>
            <Suspense fallback={null}>
                {/* The slot owns navigation, not the widget: the presentational card grid reports WHICH recipe
                    was activated, and this layer — the only one with the navigation intent — routes. Mirrors
                    the web slot exactly, so the two platforms expose the same affordance. */}
                <RecipeHomeWidget recipes={recipes} isLoading={isLoading} onSelectRecipe={onSelectRecipe} />
            </Suspense>
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

const styles = StyleSheet.create({
    slot: { gap: 8 },
    seeAll: { alignSelf: 'flex-end', paddingVertical: 4 },
    seeAllLabel: { fontSize: 14, fontWeight: '600', color: palette.seafoam },
});
