/**
 * @module home — the web Home widget-surface host (US-000 / FR-046).
 *
 * Public surface: the composition root (`HomeWidgetSurface`) rendered by the `[locale]` home route,
 * plus the appShell container factory and the nudge seam a premium-gated widget triggers.
 */
export { HomeWidgetSurface, type HomeWidgetSurfaceProps } from './HomeWidgetSurface';
export { createHomeContainer, homeContainer, HOME_FEATURES, addRecipeFeature } from './homeContainer';
export {
    HomeNudgeContext,
    SubscriptionNudge,
    useHomeNudge,
    useOncePerSessionNudge,
    type HomeNudge,
    type OncePerSessionNudge,
    type SubscriptionNudgeProps,
} from './SubscriptionNudge';
export { RecipeWidgetSlot } from './RecipeWidgetSlot';
