/**
 * @module home/RecipeWidgetHost — the Home surface's render-map entry for the recipe widget (mobile).
 *
 * The render map needs a `ComponentType`, and the slot needs the surface's navigation intents and error reporter.
 * Closing over them inside the surface made the component TYPE a function of those values, so any unstable one handed
 * React a new type every render and REMOUNTED the slot (its in-flight read and retry state reset). This module-level
 * component has one identity for the life of the app and takes the slot's props from {@link RecipeWidgetPropsContext},
 * which the surface provides — a changed prop re-renders the slot, it never remounts it.
 *
 * Both exports are orchestration: the context carries the surface's wiring, and the host reads it and renders the
 * slot; neither draws anything of its own.
 *
 * @pattern Context-injected dependency — a stable component reads what the composition root provides
 */
import { createContext, useContext, type JSX } from 'react';

import { RecipeWidgetSlot, type RecipeWidgetSlotProps } from './RecipeWidgetSlot.js';

/**
 * The props the surface hands the recipe slot. `null` outside a surface: the intents are REQUIRED (an optional seam is
 * how the cards once shipped dead), so there is no inert default to fall back on.
 */
export const RecipeWidgetPropsContext = createContext<RecipeWidgetSlotProps | null>(null);

/**
 * The recipe widget's render-map entry.
 *
 * @returns The recipe slot, wired to the surface's intents and reporter.
 */
export function RecipeWidgetHost(): JSX.Element {
    const props = useContext(RecipeWidgetPropsContext);

    if (props === null) {
        throw new Error('RecipeWidgetHost must render inside a HomeWidgetSurface.');
    }

    return <RecipeWidgetSlot {...props} />;
}
