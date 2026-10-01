import { createScrubbers } from '@kitchensink/observability-scrubbers/core';

export { DENYLIST_KEYS, isDeniedKey, looksLikeBearerToken } from '@kitchensink/observability-scrubbers/denylist';
export type { ScrubbableEvent, ScrubbableLog } from '@kitchensink/observability-scrubbers/core';

/**
 * The web app's binding of the shared PII scrubbers (KTD8) — `beforeSend` / `beforeSendLog` for all three
 * Sentry configs (client, server, edge).
 *
 * ⛔ THIS FILE USED TO BE A SECOND IMPLEMENTATION, and it drifted in both of the ways a copy does. The
 * prototype-pollution sink CodeQL found in the shared module survived here, in the browser, where the keys
 * come from whatever shape an error event has; and the email/bearer patterns stayed UNANCHORED long after
 * the shared ones were bounded, costing 38,638 ms on a 200 KB input — synchronously, inside `beforeSend`,
 * on the UI thread.
 *
 * ⚠️ The blocker was real and is now gone rather than waived: the shared package's entry imports
 * `node:crypto` for `pseudonymizeId`, which no browser bundle can take. `./core` is that package's engine
 * with no Node built-ins, so the web app gets the one implementation and its patterns without the hash.
 *
 * ⚠️ NO PSEUDONYMIZATION HERE, and that is the deliberate difference rather than a missing feature.
 * `createScrubbers()` with no argument redacts without pseudonymizing, which is exactly what this file
 * already did — a browser has no synchronous hash to do it with (`crypto.subtle` is async). The services
 * pass `pseudonymizeId` and get the correlation-preserving behaviour; the policy is one argument.
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
export const scrubEvent = <T extends Parameters<typeof scrubbers.scrubEvent>[0]>(event: T): T =>
    scrubbers.scrubEvent(event);

/**
 * `beforeSendLog` hook: drop debug logs, then redact PII from the message body and attributes.
 *
 * @param log - The Sentry log entry about to be sent.
 * @returns The scrubbed entry, or `null` to drop it. @sideEffect Mutates the entry it is given.
 */
export const scrubLog = <T extends Parameters<typeof scrubbers.scrubLog>[0]>(log: T): T | null =>
    scrubbers.scrubLog(log);
