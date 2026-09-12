import { createHash } from 'node:crypto';

/**
 * PII scrubbing for recipe-workers CloudWatch logs (GDPR Art. 17 erasure-of-copies + Art. 5
 * minimization). Parallel to the identity/webhooks Sentry scrubbers — kept local rather than shared
 * because these Lambdas bundle independently (esbuild) and the codebase already duplicates the
 * scrubber per runtime. Two behaviours, matching the Sentry contract:
 *
 * - **Denied keys** (email, name, token, …) → redacted outright.
 * - **Person-linked id keys** (`ownerId`, `userId`, `sub`, …) → pseudonymized to a stable,
 *   non-reversible token so an erased user cannot be re-identified from log copies, while incident
 *   correlation survives (same id → same token, across services). NOT bare `id`/`jobId`/`recipeId`.
 */

const DENYLIST = new Set(['email', 'password', 'token', 'authorization', 'name', 'picture', 'avatarurl', 'imageurl']);

const ID_KEYS = new Set(['sub', 'clerksub', 'clerkuserid', 'identityid', 'userid', 'ownerid', 'requesterid']);

const REDACTED = '[redacted]';

const BEARER_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

/**
 * Stable, non-reversible pseudonym for a person-linked identifier — SHA-256(id) truncated, prefixed.
 * Deterministic and cross-service-consistent; one-way for high-entropy ULIDs / Clerk `sub`s. Pure.
 */
export const pseudonymizeId = (raw: string): string =>
    `anon_${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;

const scrub = (value: unknown): unknown => {
    // Errors pass through unchanged: their message/stack are non-enumerable, so structural scrubbing
    // would silently drop them and break error logging. (Message free-text is handled at the sink.)
    if (value instanceof Error) {
        return value;
    }

    if (typeof value === 'string') {
        return BEARER_PATTERN.test(value) ? REDACTED : value;
    }

    if (Array.isArray(value)) {
        return value.map(scrub);
    }

    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};

        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            const lower = key.toLowerCase();

            if (DENYLIST.has(lower)) {
                out[key] = REDACTED;
            } else if (ID_KEYS.has(lower) && typeof nested === 'string' && nested.length > 0) {
                out[key] = pseudonymizeId(nested);
            } else {
                out[key] = scrub(nested);
            }
        }

        return out;
    }

    return value;
};

/** Deep-scrub a Powertools log-extra input: pseudonymize person ids, redact secrets. Pure. */
export const scrubLogInput = <T>(value: T): T => scrub(value) as T;
