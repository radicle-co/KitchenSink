/**
 * Shared PII scrubbers for Sentry error events and log entries.
 *
 * KTD8: `sendDefaultPii` is off everywhere, but identity-adjacent data can still reach Sentry
 * through error context and log attributes. These scrubbers strip a concrete denylist of keys and
 * redact bearer-token-shaped strings before anything leaves the host. The denylist and matcher are
 * exported so every surface (and its tests) can assert against the same contract.
 */

import { createHash } from 'node:crypto';

/** Keys whose values are always redacted, matched case-insensitively. */
export const DENYLIST_KEYS: readonly string[] = [
    'email',
    'password',
    'token',
    'authorization',
    'name',
    'picture',
    'avatarurl',
    'imageurl',
];

const DENYLIST = new Set(DENYLIST_KEYS);

/**
 * Keys whose values are a **person-linked identifier** (Clerk `sub` / app-user ULID). Unlike the
 * denylist (redacted outright), these are pseudonymized to a stable, non-reversible token so an
 * erased user cannot be re-identified from log/Sentry copies (GDPR Art. 17 erasure-of-copies +
 * Art. 5 minimization) while cross-service incident correlation is preserved. NOT bare `id` — that
 * is ambiguous (`jobId`, `recipeId`, … are not person ids); only these explicit id keys.
 */
export const ID_KEYS: readonly string[] = [
    'sub',
    'clerksub',
    'clerkuserid',
    'identityid',
    'userid',
    'ownerid',
    'requesterid',
];

const ID_KEY_SET = new Set(ID_KEYS);

/** Three dot-separated base64url segments — a JWT / bearer token shape. */
const BEARER_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

const REDACTED = '[redacted]';

/** True when a key name should have its value redacted regardless of content. */
export const isDeniedKey = (key: string): boolean => DENYLIST.has(key.toLowerCase());

/** True when a key name holds a person-linked identifier (pseudonymized, not redacted). */
export const isIdKey = (key: string): boolean => ID_KEY_SET.has(key.toLowerCase());

/** True when a string looks like a JWT / bearer token. */
export const looksLikeBearerToken = (value: string): boolean => BEARER_PATTERN.test(value);

/**
 * Stable, non-reversible pseudonym for a person-linked identifier. Deterministic (same id → same
 * token, across services and log lines, so incident correlation survives) but one-way: a Sentry /
 * CloudWatch reader cannot recover the raw id (the input — a ULID or Clerk `sub` — is high-entropy,
 * so the truncated SHA-256 is not feasibly reversible or brute-forceable). No secret to provision;
 * a keyed HMAC is the hardening path if the threat model ever needs unlinkability-against-a-holder. Pure.
 */
export const pseudonymizeId = (raw: string): string =>
    `anon_${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_GLOBAL = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
/** Clerk user `sub` embedded in free text — distinctive `user_…` prefix, safe to pseudonymize inline. */
const CLERK_SUB_GLOBAL = /user_[A-Za-z0-9]{20,}/g;

/**
 * Redact email/bearer-shaped substrings and pseudonymize embedded Clerk `sub`s in free text (error
 * messages, log bodies). ULIDs embedded in free text are left to the structured-attribute path
 * (a bare-26-char matcher would false-positive); the concrete leak sites log ids as attributes.
 */
export const scrubText = (text: string): string =>
    text
        .replace(BEARER_GLOBAL, REDACTED)
        .replace(EMAIL_PATTERN, REDACTED)
        .replace(CLERK_SUB_GLOBAL, (m) => pseudonymizeId(m));

const scrubUnknown = (value: unknown): unknown => {
    if (typeof value === 'string') {
        return looksLikeBearerToken(value) ? REDACTED : value;
    }

    if (Array.isArray(value)) {
        return value.map(scrubUnknown);
    }

    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};

        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            if (isDeniedKey(key)) {
                out[key] = REDACTED;
            } else if (isIdKey(key) && typeof nested === 'string' && nested.length > 0) {
                out[key] = pseudonymizeId(nested);
            } else {
                out[key] = scrubUnknown(nested);
            }
        }

        return out;
    }

    return value;
};

/** Deep-scrub an arbitrary structure: redact denied keys and bearer-shaped strings. Pure. */
export const scrubAttributes = <T>(value: T): T => scrubUnknown(value) as T;

/**
 * Structural shape of the parts of a Sentry error event we scrub. Declared locally rather than
 * imported because `@sentry/aws-serverless` re-exports runtime values from `@sentry/node` but not
 * the `Event`/`ErrorEvent` types.
 */
interface ScrubbableEvent {
    message?: string;
    exception?: { values?: Array<{ value?: string }> };
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    tags?: Record<string, unknown>;
    request?: { data?: unknown };
    user?: { id?: string | number } & Record<string, unknown>;
}

/**
 * `beforeSend` hook: scrub the user-data-bearing parts of an error event without disturbing SDK
 * metadata. `user.id` (the Clerk `sub` / app ULID) is **pseudonymized** — Sentry's per-user impact
 * grouping still works (same user → same token) but the raw identifier never leaves the host.
 *
 * @sideEffect mutates and returns the event, as the Sentry `beforeSend` contract expects.
 */
export const scrubEvent = <T extends ScrubbableEvent>(event: T): T => {
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
        const rawId = event.user.id;
        const id = typeof rawId === 'string' && rawId.length > 0 ? pseudonymizeId(rawId) : rawId;
        event.user = { ...scrubAttributes(event.user), id };
    }

    return event;
};

interface ScrubbableLog {
    level?: string;
    message?: string;
    attributes?: Record<string, unknown>;
}

/**
 * `beforeSendLog` hook: drop debug logs, then redact PII from the message body and attributes.
 *
 * @sideEffect mutates and returns the log, as the Sentry `beforeSendLog` contract expects.
 */
export const scrubLog = <T extends ScrubbableLog>(log: T): T | null => {
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
