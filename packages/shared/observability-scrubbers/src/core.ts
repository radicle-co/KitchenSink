import { isDeniedKey, isIdKey, looksLikeBearerToken } from './denylist.js';

/**
 * The scrubbing engine, with NO Node built-ins — the half of this package a browser and Hermes can run.
 *
 * ⛔ WHY THE SPLIT EXISTS. `scrubbers.ts` imports `node:crypto` for `pseudonymizeId`, so nothing in a web
 * or React Native bundle could import this package at all. `@commise/web` and `@commise/mobile` therefore
 * carried their own copies of the same function — and the copies drifted, which is how a
 * prototype-pollution sink closed here survived in the browser, and how both kept the UNANCHORED patterns
 * below long after the services' copy was bounded. One function in three places is one defect in three
 * places.
 *
 * ⚠️ Pseudonymization is a PARAMETER, not a second implementation. `createScrubbers()` with no argument is
 * the browser behaviour (redact only); `createScrubbers(pseudonymizeId)` is what the services get. The two
 * differ by one argument rather than by a copy, which is the whole point.
 */

/** What replaces a denied key's value or a secret-shaped substring. */
export const REDACTED = '[redacted]';

/**
 * An email address in free text, anchored by a LEADING BOUNDARY GROUP.
 *
 * ⛔ A CAPTURE GROUP, NOT A LOOKBEHIND, AND THAT IS WHAT LETS ONE IMPLEMENTATION SERVE THREE ENGINES.
 * Without a leading boundary every position inside a long run of local-part characters is retried as a
 * fresh start, each retry scanning forward for an `@` that is not there: measured at 38,638 ms on
 * `'a'.repeat(200_000) + '@'`, against 1 ms with it. A lookbehind fixes that too and was what this module
 * shipped — but lookbehind support in Hermes is not something this repository has verified, so the
 * lookbehind form had to stay out of the mobile bundle, which is exactly why mobile kept the slow one.
 * The boundary is consumed and re-inserted instead, which every engine supports.
 *
 * ⚠️ EQUIVALENT ONLY IN COMPANY WITH {@link redactAll}. Anchoring is safe WITHIN one scan — leftmost-match
 * already starts at a run boundary — but NOT across matches: `String.replace` resumes immediately after a
 * TLD, and a TLD's last character is in the local-part class, so the anchor rejects the very next address.
 * That is a PII leak, not a cosmetic difference, and it is why the scan restarts on a slice.
 */
const EMAIL_PATTERN = /(^|[^A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gu;

/** A JWT / bearer token in free text, anchored the same way and for the same reason. */
const BEARER_GLOBAL = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/gu;

/** Clerk user `sub` embedded in free text — distinctive `user_…` prefix, safe to pseudonymize inline. */
const CLERK_SUB_GLOBAL = /user_[A-Za-z0-9]{20,}/gu;

/**
 * Replace every match, RESTARTING the scan after each one and keeping the boundary the pattern consumed.
 *
 * ⛔ THIS IS WHAT MAKES THE LEADING ANCHOR SAFE, and its absence was a measured PII leak:
 * `'user@example.com-other@example.org'` redacted the first address and left the second in plaintext,
 * because the next scan began on the `m` of `.com` — a local-part character. Slicing puts each scan at a
 * fresh string boundary, where `^` matches and there is nothing behind to reject.
 *
 * ⚠️ Group 1 is re-inserted rather than redacted: it is the character BEFORE the secret and belongs to the
 * surrounding text. Dropping it silently eats a character of the operator's message.
 *
 * @param text - The text to scrub.
 * @param pattern - A global pattern whose group 1 is the leading boundary and group 2 the secret.
 * @returns The text with every match replaced. Pure.
 */
const redactAll = (text: string, pattern: RegExp): string => {
    let out = '';
    let rest = text;

    for (;;) {
        pattern.lastIndex = 0;

        const match = pattern.exec(rest);

        if (match === null) {
            return out + rest;
        }

        out += rest.slice(0, match.index) + (match[1] ?? '') + REDACTED;
        rest = rest.slice(match.index + match[0].length);
    }
};

/**
 * Structural shape of the parts of a Sentry error event we scrub. Declared locally rather than imported
 * because `@sentry/aws-serverless` re-exports runtime values from `@sentry/node` but not the
 * `Event`/`ErrorEvent` types — and because this module must not depend on a Sentry SDK at all: three
 * different ones consume it.
 */
export interface ScrubbableEvent {
    message?: string;
    exception?: { values?: Array<{ value?: string }> };
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    tags?: Record<string, unknown>;
    request?: { data?: unknown };
    user?: { id?: string | number } & Record<string, unknown>;
}

/** Structural shape of a Sentry log entry, declared locally for the same reason. */
export interface ScrubbableLog {
    level?: string;
    message?: string;
    attributes?: Record<string, unknown>;
}

/**
 * The four scrubbers one policy produces.
 *
 * ⚠️ TWO OF THEM MUTATE, and that is the Sentry contract rather than an oversight: `beforeSend` and
 * `beforeSendLog` are handed the SDK's own event object and are expected to edit it in place and return it.
 * The two that build values — `scrubText` and `scrubAttributes` — are pure and copy.
 */
export interface Scrubbers {
    /** Redact secret-shaped substrings from free text, pseudonymizing embedded ids when a policy is given. Pure. */
    readonly scrubText: (text: string) => string;
    /** Deep-scrub an arbitrary structure: redact denied keys and bearer-shaped strings. Pure; returns a copy. */
    readonly scrubAttributes: <T>(value: T) => T;
    /**
     * `beforeSend` hook: scrub the user-data-bearing parts of an event, preserving the opaque user id.
     *
     * @sideEffect Mutates and returns the event, as the Sentry `beforeSend` contract expects.
     */
    readonly scrubEvent: <T extends ScrubbableEvent>(event: T) => T;
    /**
     * `beforeSendLog` hook: drop debug logs, then redact PII from the message body and attributes.
     *
     * @sideEffect Mutates and returns the entry, as the Sentry `beforeSendLog` contract expects.
     */
    readonly scrubLog: <T extends ScrubbableLog>(log: T) => T | null;
}

/**
 * Build the scrubbers for one pseudonymization policy.
 *
 * ⛔ THE POLICY IS THE ONLY DIFFERENCE BETWEEN THE RUNTIMES, and making it an argument is what collapses
 * three copies into one. A service pseudonymizes person-linked ids so a log line still correlates to a
 * Sentry issue after erasure; a browser has no synchronous hash to do it with (`crypto.subtle` is async),
 * so it redacts and does not pseudonymize — which is exactly what the web and mobile copies already did.
 *
 * ⚠️ `pseudonymize` MUST be idempotent. A Clerk `sub` meets this twice — inline in `scrubText` and by KEY
 * in the attribute walk — and hashing an already-hashed id breaks the correlation the pseudonym exists for.
 *
 * @param pseudonymize - Idempotent id-pseudonymizer, or omitted to redact without pseudonymizing.
 * @returns The four bound scrubbers. Pure — building them has no effects; two of the four MUTATE when
 * called, which `Scrubbers` records per member rather than here.
 */
export function createScrubbers(pseudonymize?: (raw: string) => string): Scrubbers {
    const scrubText = (text: string): string => {
        const redacted = redactAll(redactAll(text, BEARER_GLOBAL), EMAIL_PATTERN);

        // ⚠️ `CLERK_SUB_GLOBAL` keeps plain `replace`: it is anchored by the literal `user_`, so it neither
        // backtracks nor needs a boundary, and it REWRITES rather than redacts.
        return pseudonymize === undefined ? redacted : redacted.replace(CLERK_SUB_GLOBAL, (m) => pseudonymize(m));
    };

    const scrubUnknown = (value: unknown): unknown => {
        // ⛔ AN Error PASSES THROUGH WHOLE. `message` and `stack` are NON-ENUMERABLE, so the object walk
        // below returns neither — an Error sent through it comes out as `{}`, the log line survives and the
        // error in it does not.
        //
        // ⚠️ It is not a hole in the denylist: a PLAIN object that merely looks like an Error still walks.
        // And free text inside `message` is handled at the sink (`beforeSend`), never here — redacting a
        // message would destroy the one field an operator reads.
        if (value instanceof Error) {
            return value;
        }

        if (typeof value === 'string') {
            return looksLikeBearerToken(value) ? REDACTED : value;
        }

        if (Array.isArray(value)) {
            return value.map(scrubUnknown);
        }

        if (value !== null && typeof value === 'object') {
            // ⛔ BUILT WITH `Object.fromEntries`, NEVER BY ASSIGNING INTO A BAG, because the keys come from
            // DATA. `out[key] = …` with `key` taken from `Object.entries` of an arbitrary payload invokes
            // `[[Set]]`, so an attribute named `__proto__` reaches `Object.prototype`'s inherited setter
            // instead of defining a property: the field is silently LOST and the object it is later merged
            // into can be polluted. `Object.fromEntries` uses `CreateDataProperty`, which defines an own
            // property and never consults a setter — so `__proto__` arrives as ordinary data.
            //
            // ⚠️ `Object.create(null)` ALSO closes the hole and was the first fix here, but CodeQL's
            // `js/remote-property-injection` does not recognise it as a sanitizer and kept failing the
            // check — correctly, in the sense that the rule is about writing an arbitrary property name at
            // all, not only about the prototype. This form satisfies both the defect and the rule, and it
            // is the spelling `prototypePollutionSinks.test.ts` already documents as safe.
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
                    if (isDeniedKey(key)) {
                        return [key, REDACTED];
                    }

                    if (pseudonymize !== undefined && isIdKey(key) && typeof nested === 'string' && nested.length > 0) {
                        return [key, pseudonymize(nested)];
                    }

                    return [key, scrubUnknown(nested)];
                }),
            );
        }

        return value;
    };

    const scrubAttributes = <T>(value: T): T => scrubUnknown(value) as T;

    const scrubEvent = <T extends ScrubbableEvent>(event: T): T => {
        if (typeof event.message === 'string') {
            event.message = scrubText(event.message);
        }

        if (event.exception?.values) {
            for (const entry of event.exception.values) {
                if (typeof entry.value === 'string') {
                    entry.value = scrubText(entry.value);
                }
            }
        }

        if (event.extra) {
            event.extra = scrubAttributes(event.extra);
        }

        if (event.contexts) {
            event.contexts = scrubAttributes(event.contexts);
        }

        if (event.tags) {
            event.tags = scrubAttributes(event.tags);
        }

        if (event.request?.data) {
            event.request.data = scrubAttributes(event.request.data);
        }

        if (event.user) {
            // ⛔ THE ID IS PUT BACK AFTER THE WALK, AND IT IS PSEUDONYMIZED ON ITS WAY. It is the one
            // identifier an operator needs to join an issue to a user, so the walk must not redact it as a
            // denied key — but under a pseudonymizing policy it must not survive RAW either, or erasure
            // leaves a real Clerk `sub` in every issue. Under the browser policy there is no pseudonymizer
            // and the id passes through unchanged, which is what those runtimes already did.
            const rawId = event.user.id;
            const id =
                pseudonymize !== undefined && typeof rawId === 'string' && rawId.length > 0
                    ? pseudonymize(rawId)
                    : rawId;

            event.user = { ...scrubAttributes(event.user), id };
        }

        return event;
    };

    const scrubLog = <T extends ScrubbableLog>(log: T): T | null => {
        if (log.level === 'debug') {
            return null;
        }

        if (typeof log.message === 'string') {
            log.message = scrubText(log.message);
        }

        if (log.attributes) {
            log.attributes = scrubAttributes(log.attributes);
        }

        return log;
    };

    return { scrubText, scrubAttributes, scrubEvent, scrubLog };
}
