/**
 * @module home — the mobile Home widget-surface host (US-000 / FR-046).
 *
 * Public surface: the composition root (`HomeWidgetSurface`) rendered by `HomeScreen`, plus the
 * appShell container factory and the nudge seam a premium-gated widget triggers.
 */
export { HomeWidgetSurface, type HomeWidgetSurfaceProps } from './HomeWidgetSurface.js';
export { createHomeContainer, homeContainer, HOME_FEATURES, addRecipeFeature } from './homeContainer.js';
export {
    HomeNudgeContext,
    SubscriptionNudge,
    useHomeNudge,
    useOncePerSessionNudge,
    type HomeNudge,
    type OncePerSessionNudge,
    type SubscriptionNudgeProps,
} from './SubscriptionNudge.js';
export { RecipeWidgetSlot, type RecipeWidgetSlotProps } from './RecipeWidgetSlot.js';
