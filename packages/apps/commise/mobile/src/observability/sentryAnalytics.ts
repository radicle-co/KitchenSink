/**
 * @module observability/sentryAnalytics — the phone's {@link AppShellAnalytics}, bound to Sentry. It forwards the ONE
 * event S12 sends and drops every other name (po P53, redteam RT7): binding the ambient `analyticsToken` is not a free
 * ride for a new product event, which needs its own decision and a widening of `ForwardedAnalyticsEvent`.
 *
 * Sentry's global scope keeps the opaque user id on every event (`sentry.ts`); this adapter adds none to the payload.
 *
 * @pattern Adapter over `@sentry/react-native`'s `captureMessage`, with an allow-list of one event name
 */
import { isForwardedAnalyticsEvent } from '@commise/features-cooking/mobile';
import type { AppShellAnalytics } from '@commise/features-core';
import * as Sentry from '@sentry/react-native';

/**
 * Sends the allowed event to Sentry as an info-level message; any other name is dropped.
 *
 * @sideEffect Reports a message to the global Sentry client.
 */
export const sentryAnalytics: AppShellAnalytics = {
    track: (event, properties) => {
        if (!isForwardedAnalyticsEvent(event)) {
            return;
        }

        Sentry.captureMessage(event, properties ? { level: 'info', extra: properties } : { level: 'info' });
    },
};
