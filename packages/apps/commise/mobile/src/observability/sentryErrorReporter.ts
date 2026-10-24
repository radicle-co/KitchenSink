/**
 * @module observability/sentryErrorReporter — the phone's {@link ErrorReporter}: the app shell's error-reporting seam
 * (DA9), bound to Sentry (`@sentry/react-native`). Home's widget boundaries resolve it from the Home container; the recipe
 * editor is handed it for a failure the cook cannot see the cause of (a Discard storage refused).
 *
 * @pattern Adapter over `@sentry/react-native`'s `captureException`
 */
import type { ErrorReporter } from '@commise/features-core';
import * as Sentry from '@sentry/react-native';

/**
 * Forward an error to Sentry, attaching the caller's context (e.g. `{ widget: descriptor.id }`) as `extra`.
 *
 * @sideEffect Reports the error to the global Sentry client.
 */
export const reportErrorToSentry: ErrorReporter = (error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
};
