/**
 * THE PII scrubbers for Sentry error events and log entries — one copy, for every runtime.
 *
 * KTD8: `sendDefaultPii` is off everywhere, but identity-adjacent data can still reach Sentry through
 * error context and log attributes. These strip a concrete denylist of keys and redact
 * bearer-token-shaped strings before anything leaves the host.
 *
 * ⛔ IT LIVES HERE BECAUSE IT HAD THREE COPIES (plan U16/U22). `identity` and `identity-webhooks` each
 * carried a near-identical file — differing only in their docstrings — and mobile carried a third inline.
 * A denylist is exactly the knowledge DRY governs: it is ONE rule about what may leave a host, and three
 * copies means the next key someone adds protects one runtime out of three. That failure is silent, and
 * silent in the direction that leaks.
 *
 * ⛔ AND THE ENGINE NOW LIVES IN `./core`, WHICH IS WHY WEB AND MOBILE ARE FINALLY CONSUMERS. This module
 * imports `node:crypto` for {@link pseudonymizeId}, and that single import is what kept a browser and
 * Hermes out of the whole package — so `@commise/web` and `@commise/mobile` each kept a copy, and the
 * copies drifted exactly as the three service copies had: a prototype-pollution sink closed here survived
 * in both browsers, and both kept UNANCHORED patterns that cost 38,638 ms on a 200 KB input long after this
 * file was bounded. `core.ts` holds the engine with no Node built-ins; this file is the Node POLICY — one
 * argument, not one more copy.
 */

import { createHash } from 'node:crypto';

import { createScrubbers } from './core.js';
import type { ScrubbableEvent, ScrubbableLog } from './core.js';

/**
 * The output shape of {@link pseudonymizeId}: `anon_` and exactly sixteen LOWERCASE hex digits.
 *
 * ⚠️ Anchored and narrow on purpose, because this is what makes the function safe to apply twice without
 * making it unsafe to apply once. No real identifier can match it: a Clerk `sub` is `user_`-prefixed, and a
 * ULID is twenty-six uppercase Crockford base32 characters. A string that merely begins `anon_` — including
 * uppercase hex — still gets hashed.
 */
const PSEUDONYM_SHAPE = /^anon_[0-9a-f]{16}$/;

/**
 * Stable, non-reversible pseudonym for a person-linked identifier. Deterministic (same id → same
 * token, across services and log lines, so incident correlation survives) but one-way: a Sentry /
 * CloudWatch reader cannot recover the raw id (the input — a ULID or Clerk `sub` — is high-entropy,
 * so the truncated SHA-256 is not feasibly reversible or brute-forceable). No secret to provision;
 * a keyed HMAC is the hardening path if the threat model ever needs unlinkability-against-a-holder.
 *
 * @param raw - The identifier to pseudonymize.
 * @returns The stable pseudonym, or the value unchanged when it already is one. Pure.
 */
export const pseudonymizeId = (raw: string): string =>
    // ⛔ IDEMPOTENT, AND THAT IS A CORRELATION REQUIREMENT. A Clerk `sub` can be pseudonymized by two
    // different rules on its way out: `scrubText` replaces it inline wherever it appears in free text, and
    // `scrubUnknown` replaces it by KEY. A value that meets both was hashed twice, and `anon_<h1>` hashed
    // again is `anon_<h2>` — so `identity/src/queue/deletionEnqueue.error.ts`, which emits an ISSUE and a
    // LOG for the SAME ids in one function, put a different token on each. An operator pivoting between
    // them for the same human found nothing, silently, which is exactly the outcome pseudonymizing rather
    // than redacting exists to avoid (ADR-0043).
    PSEUDONYM_SHAPE.test(raw) ? raw : `anon_${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;

/**
 * The Node policy: redact, AND pseudonymize person-linked identifiers.
 *
 * ⚠️ The browser policy is the same engine with no pseudonymizer — see `core.ts`. The difference between
 * the runtimes is this one argument.
 */
const scrubbers = createScrubbers(pseudonymizeId);

/**
 * Redact email/bearer-shaped substrings and pseudonymize embedded Clerk `sub`s in free text (error
 * messages, log bodies). ULIDs embedded in free text are left to the structured-attribute path
 * (a bare-26-char matcher would false-positive); the concrete leak sites log ids as attributes.
 *
 * @param text - The free text to scrub.
 * @returns The text with secrets redacted in place and Clerk `sub`s pseudonymized. Pure.
 */
export const scrubText = (text: string): string => scrubbers.scrubText(text);

/**
 * Deep-scrub an arbitrary structure: redact denied keys, redact bearer-shaped strings, and pseudonymize
 * person-linked ids by key.
 *
 * @param value - The structure to scrub.
 * @returns A scrubbed copy of the same shape. Pure.
 */
export const scrubAttributes = <T>(value: T): T => scrubbers.scrubAttributes(value);

/**
 * `beforeSend` hook: scrub the user-data-bearing parts of an event, preserving the opaque user id.
 *
 * @param event - The Sentry event about to be sent.
 * @returns The same event, scrubbed in place. @sideEffect Mutates the event it is given.
 */
export const scrubEvent = <T extends ScrubbableEvent>(event: T): T => scrubbers.scrubEvent(event);

/**
 * `beforeSendLog` hook: drop debug logs, then redact PII from the message body and attributes.
 *
 * @param log - The Sentry log entry about to be sent.
 * @returns The scrubbed entry, or `null` to drop it. @sideEffect Mutates the entry it is given.
 */
export const scrubLog = <T extends ScrubbableLog>(log: T): T | null => scrubbers.scrubLog(log);

export type { ScrubbableEvent, ScrubbableLog } from './core.js';
