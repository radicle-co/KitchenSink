/**
 * @module @commise/features-core/home — the Home appShell container factory (US-000 discovery layer).
 *
 * @pattern Factory + Composition Root helper — the apps pass what differs (their feature registrations and their Sentry
 * binding); the shape of the container is stated once.
 */
import { createContainer, type Container } from 'ditox';

import { errorReporterToken, type AddFeature, type ErrorReporter } from '../appShell.js';

/** What an app supplies to build its Home container. */
export interface CreateHomeContainerInput {
    /**
     * Every feature registration to apply, in order. Order does not affect the rendered order (`curateHomeWidgets` sorts
     * by weight and personalization). Append a feature's `addFeature` here when its package ships.
     */
    readonly features: readonly AddFeature[];
    /** The platform's real reporter (Sentry), bound as the ambient `errorReporterToken` (DA9). */
    readonly errorReporter: ErrorReporter;
}

/**
 * Build a fresh Home appShell container with the reporter bound and every feature registered. A factory with no shared
 * state, so tests get an isolated container per case while an app holds one singleton.
 *
 * The reporter is bound HERE so prod and test containers built through this factory share ONE binding path: the
 * widget boundaries resolve the same seam in production that tests bind a fake onto.
 *
 * @param input - The feature registrations and the platform's error reporter.
 * @returns A ditox container with the reporter and each feature's Home widgets bound.
 * @sideEffect Mutates the freshly created container by binding the reporter and each feature's contributions.
 */
export function createHomeContainer({ features, errorReporter }: CreateHomeContainerInput): Container {
    const container = createContainer();

    container.bindValue(errorReporterToken, errorReporter);

    for (const addFeature of features) {
        addFeature(container);
    }

    return container;
}
