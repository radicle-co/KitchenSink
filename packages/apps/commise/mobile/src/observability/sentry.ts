import * as Sentry from '@sentry/react-native';

import { createScrubbers } from '@kitchensink/observability-scrubbers/core';
import type { ScrubbableEvent, ScrubbableLog } from '@kitchensink/observability-scrubbers/core';

/**
 * Sentry setup for the mobile app (U10 / KTD9 — @sentry/react-native v8).
 *
 * PII is off by default (the RN quickstart enables it; we override per KTD8) and a shared denylist
 * scrubber redacts identity-adjacent fields before anything leaves the device. `initSentry` is a
 * function (not top-level side effect) so it stays unit-testable; `App.tsx` calls it then wraps the
 * root with `Sentry.wrap` for the error boundary + navigation instrumentation.
 */
export { DENYLIST_KEYS, isDeniedKey, looksLikeBearerToken } from '@kitchensink/observability-scrubbers/denylist';

/**
 * The mobile app's binding of the shared PII scrubbers (KTD8) — `beforeSend` / `beforeSendLog`.
 *
 * ⛔ THIS USED TO BE A THIRD IMPLEMENTATION, and it drifted exactly as the web copy did: it kept the
 * prototype-pollution sink the shared module had closed, and it kept UNANCHORED email/bearer patterns that
 * cost 38,638 ms on a 200 KB input — synchronously, inside `beforeSend`, on a phone.
 *
 * ⚠️ TWO RECORDED REASONS FOR THE COPY, AND BOTH ARE NOW DISCHARGED RATHER THAN WAIVED. The first was real:
 * the package entry imports `node:crypto`, which React Native does not have — `./core` is that package's
 * engine with no Node built-ins, so it no longer applies. The second was that taking a subpath export
 * "means resolving a subpath through Metro, and nothing here runs Metro"; that was an assumption, and it is
 * falsifiable by inspection — this app already resolves twenty-odd workspace subpath exports
 * (`@commise/ui/button`, `@commise/query/boundary`, `@commise/features-account/danger`, …).
 *
 * ⚠️ A LOOKBEHIND WOULD STILL BE UNSAFE HERE, and that is why the shared patterns no longer use one. The
 * anchor that bounds the backtracking is a consumed-and-reinserted capture group, which every engine
 * supports — so Hermes needs no exception and there is no second pattern to keep in step.
 *
 * ⚠️ NO PSEUDONYMIZATION, deliberately: `createScrubbers()` with no argument redacts without hashing, which
 * is what this file already did. A device has no synchronous hash (`crypto.subtle` is async).
 */
const scrubbers = createScrubbers();

/**
 * Redact email- and bearer-token-shaped substrings from free text (error messages, log bodies).
 *
 * @param text - The free text to scrub.
 * @returns The text with secrets redacted in place. Pure.
 */
export const scrubText = (text: string): string => scrubbers.scrubText(text);

/**
 * Deep-scrub an arbitrary structure: redact denied keys and bearer-shaped strings.
 *
 * @param value - The structure to scrub.
 * @returns A scrubbed copy of the same shape. Pure.
 */
export const scrubAttributes = <T>(value: T): T => scrubbers.scrubAttributes(value);

/**
 * `beforeSend` hook: scrub user-data-bearing parts of an event, preserving the opaque user id.
 *
 * @param event - The Sentry event about to be sent.
 * @returns The same event, scrubbed. @sideEffect Mutates the event it is given.
 */
export const scrubEvent = <T extends ScrubbableEvent>(event: T): T => scrubbers.scrubEvent(event);

/**
 * `beforeSendLog` hook: drop debug logs, then redact PII from the message body and attributes.
 *
 * @param log - The Sentry log entry about to be sent.
 * @returns The scrubbed entry, or `null` to drop it. @sideEffect Mutates the entry it is given.
 */
export const scrubLog = <T extends ScrubbableLog>(log: T): T | null => scrubbers.scrubLog(log);

/**
 * The release a mobile build reports under (plan U19).
 *
 * ⛔ Mobile events carried NO release at all, which makes two things impossible that Sentry is otherwise
 * good at: attributing a crash to the build it came from, and telling a regression from a long-standing
 * bug. Both matter more on mobile than on web, because installed builds linger — several versions are live
 * at once and there is no "deploy" that retires the old ones.
 *
 * ⚠️ `undefined` rather than a placeholder when unknown, for the reason the web half gives: a made-up
 * release silently groups unrelated builds together, which is harder to notice than an absent one.
 *
 * ⚠️ `EAS_BUILD_GIT_COMMIT_HASH` is last and is the one that works WITHOUT anybody wiring anything: EAS sets
 * it on every cloud build. The two `EXPO_PUBLIC_` variables come first so a local or CI build can state a
 * release EAS does not know about — but if both are forgotten, a real build still carries its commit rather
 * than nothing.
 *
 * @param env - The build environment.
 * @returns The commit SHA, or `undefined`. Pure.
 */
export const mobileRelease = (env: Record<string, string | undefined>): string | undefined =>
    env['EXPO_PUBLIC_SENTRY_RELEASE'] ?? env['EXPO_PUBLIC_COMMIT_SHA'] ?? env['EAS_BUILD_GIT_COMMIT_HASH'];

/**
 * How much tracing a mobile build samples.
 *
 * ⛔ Below 1 outside development. A quota that fills drops ERRORS as well as traces, so sampling every
 * transaction from every installed device is a way to lose the events this SDK exists to deliver.
 *
 * @param environment - The Sentry environment.
 * @returns A sample rate in [0, 1]. Pure.
 */
export const mobileTracesSampleRate = (environment: string): number => (environment === 'development' ? 1.0 : 0.2);

/**
 * Initialize Sentry for the mobile app. Inert when `EXPO_PUBLIC_SENTRY_DSN` is unset (local dev).
 *
 * @returns `true` when Sentry was configured (a DSN was present), `false` when it stayed inert. The
 *   caller uses this to decide whether to `Sentry.wrap` the root — wrapping without an initialized
 *   client emits an "App Start Span could not be finished. `Sentry.wrap` was called before `Sentry.init`"
 *   warning, so an un-initialized build should skip the wrap entirely.
 * @sideEffect configures the global Sentry client.
 */
export const initSentry = (): boolean => {
    const dsn = process.env['EXPO_PUBLIC_SENTRY_DSN'];

    if (!dsn) {
        return false;
    }

    const environment = process.env['EXPO_PUBLIC_STAGE'] ?? 'development';
    const release = mobileRelease(process.env);

    Sentry.init({
        dsn,
        enableLogs: true,
        sendDefaultPii: false,
        // ⛔ NOT a flat 1.0 any more (plan U19). Every installed build sampled EVERY transaction, which is
        // fine on a simulator and is a bill plus a quota ceiling on real devices — and a quota that fills
        // drops errors, not just traces, so over-sampling traces is a way to lose the events that matter.
        tracesSampleRate: mobileTracesSampleRate(environment),
        environment,
        // ⚠️ SPREAD, not `release: undefined`. Sentry treats an explicitly-undefined release differently
        // from an absent key in some SDK versions, and a build with no SHA should look to Sentry exactly
        // like the un-released builds that came before this change rather than like a release named
        // "undefined".
        ...(release === undefined ? {} : { release }),
        beforeSend: scrubEvent,
        beforeSendLog: scrubLog,
    });

    return true;
};
