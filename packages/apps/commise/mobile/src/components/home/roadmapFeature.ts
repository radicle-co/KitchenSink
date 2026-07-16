/**
 * @module home/roadmapFeature — registers the roadmap skeleton placeholders into the mobile Home container.
 *
 * The mobile half of the roadmap scaffolding (FR-046 / R6 as amended by CR-001). `@commise/features-core`
 * owns the roadmap METADATA (ids, capabilities, weights — shared with web so the two cannot drift); this
 * module owns the NATIVE skeleton components and binds one to each id. The loaders resolve HOST-owned modules
 * (the platform-resolved `.native` skeletons), so nothing here imports from an unbuilt feature package —
 * exactly why the original R6 objection ("`import()` of an unbuilt package fails the build") does not apply.
 *
 * **To retire a placeholder** when its feature ships: delete its entry from `ROADMAP_WIDGET_SPECS` and its
 * skeleton file. Nothing else changes — the feature's own descriptor takes over by id.
 */
import {
    createRoadmapPlaceholders,
    registerHomeWidget,
    type AddFeature,
    type HomeWidgetLoader,
    type RoadmapWidgetId,
} from '@commise/features-core';

/**
 * The native skeleton component for each roadmap widget id. Typed as a TOTAL `Record<RoadmapWidgetId, …>`:
 * adding an id to the shared registry without adding a native skeleton is a compile error, which is how
 * FR-044 platform parity is enforced here rather than trusted. Metro (and the mobile vitest resolver) resolve
 * each bare path to its `.native.tsx` leaf.
 */
const ROADMAP_SKELETON_LOADERS: Readonly<Record<RoadmapWidgetId, HomeWidgetLoader>> = {
    nutrition: () =>
        import('./skeletons/NutritionWidgetSkeleton.js').then((module) => ({
            default: module.NutritionWidgetSkeleton,
        })),
    'resume-cooking': () =>
        import('./skeletons/ResumeCookingWidgetSkeleton.js').then((module) => ({
            default: module.ResumeCookingWidgetSkeleton,
        })),
    'meal-plan': () =>
        import('./skeletons/MealPlanWidgetSkeleton.js').then((module) => ({
            default: module.MealPlanWidgetSkeleton,
        })),
};

/**
 * The roadmap registration: contributes one placeholder descriptor per roadmap widget to the Home container.
 * Shaped like a feature's own `addFeature` so the composition root treats it identically.
 *
 * @param container - The appShell container to register the placeholders into.
 * @sideEffect Mutates `container` by binding each placeholder to the multi-value Home-widget token.
 */
export const addRoadmapPlaceholders: AddFeature = (container) => {
    for (const descriptor of createRoadmapPlaceholders(ROADMAP_SKELETON_LOADERS)) {
        registerHomeWidget(container, descriptor);
    }
};
