/**
 * @module home/homeContainer — the web Home appShell container (US-000 discovery layer).
 *
 * Builds the ditox `appShell` container and applies each feature's `addFeature` registration, so the
 * composition root ({@link import('./HomeWidgetSurface.js').HomeWidgetSurface}) can resolve the full set of
 * contributed Home-widget descriptors via `resolveHomeWidgets` and hand them to `curateHomeWidgets`.
 *
 * In Home v1 only the recipe feature registers a widget. A feature package (005–009) lights up its widget by
 * adding its own `addFeature` line to {@link HOME_FEATURES} when it ships — no central widget registry is
 * edited; each feature owns its descriptor — and capability gating in `curateHomeWidgets` then reveals it
 * once its backing service is live.
 *
 * This container is also where the ambient {@link errorReporterToken} (DA9) is bound to the real reporter —
 * web Sentry (`@sentry/nextjs`) — so `HomeWidgetSurface`'s widget-boundary `onError` resolves the SAME
 * injected seam in production that tests bind a fake onto.
 */
import { errorReporterToken, registerHomeWidget, type AddFeature, type ErrorReporter } from '@commise/features-core';
import { recipeHomeWidgetDescriptor } from '@commise/features-recipes';
import * as Sentry from '@sentry/nextjs';
import { createContainer, type Container } from 'ditox';

import { addRoadmapPlaceholders } from './roadmapFeature';

/**
 * The web {@link ErrorReporter} bound onto {@link homeContainer}: forwards to Sentry, attaching the caller's
 * context (e.g. `{ widget: descriptor.id }`) as `extra` so a Home-widget crash is traceable back to the
 * widget that threw.
 *
 * @sideEffect Reports the error to the global Sentry client.
 */
export const reportWidgetErrorToSentry: ErrorReporter = (error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
};

/**
 * The recipe feature's Home registration: contributes {@link recipeHomeWidgetDescriptor} to the appShell
 * container's multi-value widget token. This is the feature's `.use(addFeature)` seam.
 */
export const addRecipeFeature: AddFeature = (container) => {
    registerHomeWidget(container, recipeHomeWidgetDescriptor);
};

/**
 * Every feature registration applied to the Home container, in registration order. Home v1 = the recipe
 * feature, plus the roadmap scaffolding that stands in for the features that do not exist yet (FR-046 / R6
 * as amended by CR-001). Append a feature's `addFeature` here when its package ships — and delete its
 * roadmap entry at the same time (leaving it is harmless: it gates itself out once the capability is live).
 *
 * Registration order is irrelevant to the rendered order — `curateHomeWidgets` sorts by weight/personalization.
 */
export const HOME_FEATURES: readonly AddFeature[] = [addRecipeFeature, addRoadmapPlaceholders];

/**
 * Build a fresh Home appShell container with every supplied feature registered. A pure factory (no shared
 * mutable state), so tests get an isolated container per case while the app holds a single module singleton.
 *
 * @param features - The feature registrations to apply; defaults to {@link HOME_FEATURES}.
 * @returns A ditox container with each feature's Home widget bound.
 * @sideEffect Mutates the freshly-created container by binding each feature's contributions.
 */
export function createHomeContainer(features: readonly AddFeature[] = HOME_FEATURES): Container {
    const container = createContainer();

    // Ambient appShell dependency the Home surface resolves for widget-boundary observability (DA9) — bound
    // here so prod and test containers built through this factory share ONE binding path for the reporter.
    container.bindValue(errorReporterToken, reportWidgetErrorToSentry);

    for (const addFeature of features) {
        addFeature(container);
    }

    return container;
}

/** The app-wide Home appShell container singleton (built once with every v1 feature registered). */
export const homeContainer: Container = createHomeContainer();
