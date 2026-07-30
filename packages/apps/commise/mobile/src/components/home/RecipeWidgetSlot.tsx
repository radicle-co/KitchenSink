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
 * presentational widget building blocks carry no navigation. That entry is the viewer's route off Home, so it
 * is deliberately insulated from the widget body: an inner `Suspense` keeps it mounted while the chunk
 * resolves, and an inner `ErrorBoundary` keeps it mounted when the chunk (or the widget) FAILS — see the
 * boundary's own comment for why the host's per-widget boundary is not sufficient on its own.
 */
import { recipeHomeWidgetDescriptor } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { Recipe } from '@kitchensink/recipe-core';
import { useRecipes } from '@kitchensink/recipe-service-client/hooks';
import { Suspense, lazy, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';
import { HomeWidgetErrorNotice } from './HomeWidgetErrorNotice.js';

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
    const query = useRecipes({ pageSize: RECENT_RECIPE_LIMIT });

    const recipes = query.data?.data ?? [];
    const isLoading = query.isLoading;

    return (
        <View style={styles.slot}>
            {/* Scoped to the WIDGET BODY, and deliberately INSIDE this slot rather than left to the host's
                per-widget boundary. The host wraps the whole slot in `<ErrorBoundary fallback={null}>`, so
                without this inner boundary a widget-body throw erases the "see all recipes" entry too — the
                viewer's route out of Home vanishes along with the content that failed. Observed in CI: Home
                rendered its roadmap placeholders and then blank space, and Maestro's shared `signin.yaml`
                could never leave Home.

                `Suspense` cannot cover this: it handles a PENDING lazy chunk, never a REJECTED one, and
                `React.lazy` CACHES a rejection — so once the chunk fails it re-throws on every later render
                and the slot never recovers on its own. Losing the widget's content to a failed chunk is
                acceptable; losing the navigation is not.

                The fallback is a localized NOTICE, not `null`: blank space explained nothing and gave a
                screen-reader user no signal at all, while web rendered its `widgetError` copy here — a
                cross-platform drift (§14). It carries NO "try again" control, and that is deliberate. React's
                `lazyInitializer` calls the loader only while the payload is Uninitialized; a rejection sets
                `_status = 2` and every later render re-`throw`s the cached `_result` WITHOUT re-invoking the
                loader. `RecipeHomeWidget` is built once at module scope, so resetting this boundary would
                re-throw immediately and the button would look broken. A real retry would have to mint a NEW
                `lazy()` (a generation counter keying `useMemo`) — worth doing only once we know what actually
                throws here, since on a single-bundle Metro build a rejected `import()` is a module-EVALUATION
                failure, which a re-import would deterministically reproduce. */}
            <ErrorBoundary fallback={<HomeWidgetErrorNotice />} onError={(error) => onWidgetError?.(error)}>
                <Suspense fallback={null}>
                    {/* The slot owns navigation, not the widget: the presentational card grid reports WHICH
                        recipe was activated, and this layer — the only one with the navigation intent —
                        routes. Mirrors the web slot exactly, so the two platforms expose the same affordance. */}
                    <RecipeHomeWidget recipes={recipes} isLoading={isLoading} onSelectRecipe={onSelectRecipe} />
                </Suspense>
            </ErrorBoundary>
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
    // `ocean-dark`, not `seafoam`: this is text a reader reads (see the palette JSDoc in `@commise/ui`).
    seeAllLabel: { fontSize: 14, fontWeight: '600', color: palette['ocean-dark'] },
});
