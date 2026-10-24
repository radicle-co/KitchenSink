/**
 * @module lib/sentryErrorReporter — the web's {@link ErrorReporter}: the app shell's error-reporting seam (DA9), bound to
 * Sentry (`@sentry/nextjs`). Home's widget boundaries resolve it from the Home container; the recipe editor is handed it
 * for a failure the cook cannot see the cause of (a Discard storage refused).
 *
 * @pattern Adapter over `@sentry/nextjs`'s `captureException`
 */
import type { ErrorReporter } from '@commise/features-core';
import * as Sentry from '@sentry/nextjs';

/**
 * Forward an error to Sentry, attaching the caller's context (e.g. `{ widget: descriptor.id }`) as `extra`.
 *
 * @sideEffect Reports the error to the global Sentry client.
 */
export const reportErrorToSentry: ErrorReporter = (error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
};
