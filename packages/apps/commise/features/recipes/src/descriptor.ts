/**
 * @module @commise/features-recipes — the recipe Home-widget descriptor (discovery layer).
 *
 * A feature owns its widget declaration next to its code, so the composition root
 * only has to `.use(addFeature)` / `registerHomeWidget(container, descriptor)` —
 * no central registry is edited. The `load` seam is a literal, statically
 * analyzable dynamic `import()` that the app bundler resolves per platform (web →
 * `RecipeHomeWidget.tsx`; Metro → `RecipeHomeWidget.native.tsx`), keeping the
 * component code split out of the initial bundle.
 */

import type { HomeWidgetDescriptor } from '@commise/features-core';

/**
 * Stable Home-widget id for the recipe (recent-recipes) widget — the only
 * registered widget in Home v1.
 */
export const RECIPE_HOME_WIDGET_ID = 'recipes';

/**
 * Capability that must be live for the recipe widget to render. Backed by the 001
 * recipe service; the Home host seeds this into `liveCapabilities`.
 */
export const RECIPE_HOME_WIDGET_CAPABILITY = 'recipes';

/**
 * Default ordering weight for the recipe widget. High, so it leads Home until the
 * viewer personalizes their layout.
 */
export const RECIPE_HOME_WIDGET_DEFAULT_WEIGHT = 1000;

/**
 * The recipe Home-widget descriptor, conforming to the `@commise/features-core`
 * {@link HomeWidgetDescriptor} contract. No `minTier` — the recipe widget is
 * available to every tier.
 */
export const recipeHomeWidgetDescriptor: HomeWidgetDescriptor = {
    id: RECIPE_HOME_WIDGET_ID,
    load: () => import('./widget/RecipeHomeWidget.js'),
    defaultWeight: RECIPE_HOME_WIDGET_DEFAULT_WEIGHT,
    capability: RECIPE_HOME_WIDGET_CAPABILITY,
};
