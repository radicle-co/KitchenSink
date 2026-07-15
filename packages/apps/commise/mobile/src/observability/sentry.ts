import * as Sentry from '@sentry/react-native';

/**
 * Sentry setup for the mobile app (U10 / KTD9 — @sentry/react-native v8).
 *
 * PII is off by default (the RN quickstart enables it; we override per KTD8) and a shared denylist
 * scrubber redacts identity-adjacent fields before anything leaves the device. `initSentry` is a
 * function (not top-level side effect) so it stays unit-testable; `App.tsx` calls it then wraps the
 * root with `Sentry.wrap` for the error boundary + navigation instrumentation.
 */

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

const BEARER_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

const REDACTED = '[redacted]';

export const isDeniedKey = (key: string): boolean => DENYLIST.has(key.toLowerCase());

export const looksLikeBearerToken = (value: string): boolean => BEARER_PATTERN.test(value);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_GLOBAL = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/** Redact email- and bearer-token-shaped substrings from free text (error messages, log bodies). */
export const scrubText = (text: string): string =>
    text.replace(BEARER_GLOBAL, REDACTED).replace(EMAIL_PATTERN, REDACTED);

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
            out[key] = isDeniedKey(key) ? REDACTED : scrubUnknown(nested);
        }

        return out;
    }

    return value;
};

export const scrubAttributes = <T>(value: T): T => scrubUnknown(value) as T;

interface ScrubbableEvent {
    message?: string;
    exception?: { values?: Array<{ value?: string }> };
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    tags?: Record<string, unknown>;
    request?: { data?: unknown };
    user?: { id?: string | number } & Record<string, unknown>;
}

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
        const id = event.user.id;
        event.user = { ...scrubAttributes(event.user), id };
    }

    return event;
};

interface ScrubbableLog {
    level?: string;
    message?: string;
    attributes?: Record<string, unknown>;
}

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

    Sentry.init({
        dsn,
        enableLogs: true,
        sendDefaultPii: false,
        tracesSampleRate: 1.0,
        environment: process.env['EXPO_PUBLIC_STAGE'] ?? 'development',
        beforeSend: scrubEvent,
        beforeSendLog: scrubLog,
    });

    return true;
};
