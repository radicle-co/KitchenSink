/**
 * @module home/homeContainer — the web Home appShell container (US-000 discovery layer).
 *
 * The container's shape is `createHomeContainer` in `@commise/features-core/home`, shared with mobile; this module
 * supplies what differs by app: the feature registrations (the roadmap skeletons are this app's own) and the web
 * Sentry reporter bound as the ambient `errorReporterToken` (DA9), so `HomeWidgetSurface`'s widget-boundary `onError`
 * resolves the SAME injected seam in production that tests bind a fake onto.
 *
 * In Home v1 the recipe feature registers a widget, plus the roadmap scaffolding that stands in for the features that
 * do not exist yet (FR-046 / R6 as amended by CR-001). A feature package (005–009) lights up its widget by adding its
 * `addFeature` to the list below when it ships — and its roadmap entry is deleted at the same time (leaving it is
 * harmless: it gates itself out once the capability is live). No central widget registry is edited; each feature owns
 * its descriptor, and capability gating in `curateHomeWidgets` reveals it once its backing service is live.
 */
import { createHomeContainer } from '@commise/features-core/home';
import { addRecipeFeature } from '@commise/features-recipes';
import type { Container } from 'ditox';

import { reportErrorToSentry } from '@/lib/sentryErrorReporter';

import { addRoadmapPlaceholders } from './roadmapFeature';

/** The app-wide Home appShell container singleton (built once with every v1 feature registered). */
export const homeContainer: Container = createHomeContainer({
    features: [addRecipeFeature, addRoadmapPlaceholders],
    errorReporter: reportErrorToSentry,
});
