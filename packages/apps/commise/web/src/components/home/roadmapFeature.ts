/**
 * @module home/roadmapFeature — registers the roadmap skeleton placeholders into the web Home container.
 *
 * The web half of the roadmap scaffolding (FR-046 / R6 as amended by CR-001). `@commise/features-core` owns
 * the roadmap METADATA (ids, capabilities, weights — shared with mobile so the two cannot drift); this module
 * owns the WEB skeleton components and binds one to each id.
 *
 * The loaders resolve HOST-owned modules — nothing here imports from an unbuilt feature package, which is
 * exactly why the original R6 objection ("`import()` of an unbuilt package fails the build") does not apply.
 *
 * **To retire a placeholder** when its feature ships: delete its entry from `ROADMAP_WIDGET_SPECS` and its
 * skeleton file. Nothing else changes — the feature's own descriptor takes over by id, and until the entry is
 * deleted the placeholder simply gates itself out (capability now live), so forgetting is safe.
 */
import {
    createRoadmapPlaceholders,
    registerHomeWidget,
    type AddFeature,
    type HomeWidgetLoader,
    type RoadmapWidgetId,
} from '@commise/features-core';

/**
 * The web skeleton component for each roadmap widget id.
 *
 * Typed as a TOTAL `Record<RoadmapWidgetId, …>`: adding an id to the shared registry without adding a web
 * skeleton is a compile error, which is how FR-044 platform parity is enforced here rather than trusted.
 *
 * These are dynamic `import()`s to honour the descriptor's loader seam, but they are cheap and local — a
 * skeleton is a handful of divs, so it resolves from the app's own chunk graph rather than the network in
 * practice.
 */
const ROADMAP_SKELETON_LOADERS: Readonly<Record<RoadmapWidgetId, HomeWidgetLoader>> = {
    nutrition: () =>
        import('./skeletons/NutritionWidgetSkeleton').then((module) => ({ default: module.NutritionWidgetSkeleton })),
    'resume-cooking': () =>
        import('./skeletons/ResumeCookingWidgetSkeleton').then((module) => ({
            default: module.ResumeCookingWidgetSkeleton,
        })),
    'meal-plan': () =>
        import('./skeletons/MealPlanWidgetSkeleton').then((module) => ({ default: module.MealPlanWidgetSkeleton })),
};

/**
 * The roadmap registration: contributes one placeholder descriptor per roadmap widget to the Home container.
 * Shaped like a feature's own `addFeature` so the composition root treats it identically — the roadmap is
 * "the feature that stands in for the features that do not exist yet".
 *
 * @sideEffect Mutates `container` by binding each placeholder to the multi-value Home-widget token.
 */
export const addRoadmapPlaceholders: AddFeature = (container) => {
    for (const descriptor of createRoadmapPlaceholders(ROADMAP_SKELETON_LOADERS)) {
        registerHomeWidget(container, descriptor);
    }
};
