/**
 * THE REMOTE SEARCH SERVICE's WIRE CONTRACT (ADR-0055 points 2, 6, 7 and 9), authored here and copied into
 * `@kitchensink/schema-remote-search` (`docs/CODING_STANDARDS.md` §15.2). Its one caller is food-service: the apps
 * never call this service (ADR-0055 point 3).
 *
 * A search is `GET /v{major}/{source}/{adapterRevision}/search?q=&admit=&rid=`. The cache key is the path and `q`;
 * `admit` and `rid` are signed but kept out of it (ADR-0055 points 2 and 7). So only the two `200` answers may be
 * shared, and every other answer is `no-store`.
 *
 * IMPORT RESTRICTION (enforced by `@kitchensink/contract-gen`): this file may import only `zod`.
 *
 * @module
 */
import { z } from 'zod';

/** The contract's major version: the `v{major}` path segment. */
export const REMOTE_SEARCH_CONTRACT_MAJOR = 1;

/** Every source the service searches. A source joins with an entry here, a revision below, and an adapter. */
export const remoteSearchSourceSchema = z.enum(['usda']);

export type RemoteSearchSource = z.infer<typeof remoteSearchSourceSchema>;

/**
 * Each source adapter's revision: the `{adapterRevision}` path segment, and so part of the cache key. A change to what
 * an adapter answers for the same query (its mapping, or the request it sends the source) bumps it, and answers
 * cached under the old revision are never read again.
 */
export const REMOTE_SEARCH_ADAPTER_REVISIONS: Readonly<Record<RemoteSearchSource, number>> = Object.freeze({
    usda: 2,
});

/**
 * The path of one source's search, at its current adapter revision. Pure.
 *
 * @param source - The source.
 * @returns `/v{major}/{source}/{adapterRevision}/search`.
 */
export function remoteSearchPath(source: RemoteSearchSource): string {
    return `/v${String(REMOTE_SEARCH_CONTRACT_MAJOR)}/${source}/${String(REMOTE_SEARCH_ADAPTER_REVISIONS[source])}/search`;
}

/**
 * The response header that echoes the request's `rid`, on every response to a request whose `rid` parses. A cached
 * answer echoes the request that stored it, so a caller applies a quota reading or a block only from a response that
 * echoes its own `rid` (ADR-0055 point 6).
 */
export const REMOTE_SEARCH_RID_HEADER = 'x-search-rid';

/**
 * The status of a miss asked with `admit=0` ({@link remoteSearchNotAdmittedSchema}): a `200`, because the answer
 * is an OUTCOME like `found` and `empty`. It was a `428` until 2026-10-05, when the deployed stage proved CloudFront
 * error-caches a 4xx the distribution cannot pin (428 sits outside the configurable error set), which is the first
 * of two causes of one defect; {@link REMOTE_SEARCH_NOT_ADMITTED_MAX_AGE_SECONDS} is the second (ADR-0055 points 2
 * and 6).
 */
export const REMOTE_SEARCH_NOT_ADMITTED_STATUS = 200;

/**
 * How long, in seconds, the CDN keeps a "not admitted": the shortest time that is a real cache entry.
 *
 * ⛔ It cannot be `0`, and it cannot be any response the CDN refuses to store. Measured on 2026-10-05, on the deployed
 * stage and on a scratch distribution with this stage's cache policy (key on `q`, min and default TTL 0): after an
 * uncacheable response for a `(path, q)` — `no-store`, `no-cache`, `private`, `max-age=0`, `s-maxage=0`, no
 * `Cache-Control` at all, an error status whose error TTL is 0, a redirect, or a `HEAD` probe — the CDN would not
 * store the next cacheable answer for that key for about three minutes. Food probes before it admits, so the admitted
 * answer was never kept and every repeat of a search spent a source call. A positive TTL does not do this. The
 * price: an admitted request that lands inside the second is served the probe's "not admitted" and must ask again
 * once it lapses ({@link REMOTE_SEARCH_NOT_ADMITTED_RETRY_DELAY_MS}).
 */
export const REMOTE_SEARCH_NOT_ADMITTED_MAX_AGE_SECONDS = 1;

/**
 * How long a caller waits before asking again, in milliseconds, when its admitted request was answered with a
 * replayed "not admitted": the TTL, plus a margin for the clock difference between the CDN and the caller.
 */
export const REMOTE_SEARCH_NOT_ADMITTED_RETRY_DELAY_MS = REMOTE_SEARCH_NOT_ADMITTED_MAX_AGE_SECONDS * 1000 + 250;

/**
 * The status of a source's failure: `SOURCE_ERROR`, which carries the source's own status, and
 * `SOURCE_INVALID_RESPONSE` ({@link remoteSearchErrorSchema}). Never stored.
 */
export const REMOTE_SEARCH_SOURCE_FAILURE_STATUS = 502;

/**
 * The longest the CDN waits for this service's answer to one forwarded request, in milliseconds: its origin read
 * timeout. The search function's own timeout sits below it, and a caller waits longer than it, so the CDN, never the
 * caller, ends a slow request.
 */
export const REMOTE_SEARCH_LATENCY_BOUND_MS = 20_000;

/** The query of one search. */
export const remoteSearchQuerySchema = z.object({
    /**
     * The term, already in the canonical form food-service's `searchTermQuerySchema` (`@kitchensink/schema-food`)
     * produces: it parses, and parses to itself. Any other term is a `400`.
     */
    q: z.string(),
    /** `1` lets the service call the source on a miss. `0` is answered `notAdmitted`, and the source is not called. */
    admit: z.enum(['0', '1']),
    /** The caller's request id. Letters, digits and hyphens only, so its echo is always a valid header value. */
    rid: z.string().regex(/^[0-9A-Za-z-]{16,64}$/u),
});

export type RemoteSearchQuery = z.infer<typeof remoteSearchQuerySchema>;

/** One remote food, in our canonical form (FR-IDN-2). */
export const remoteSearchItemSchema = z.object({
    /** The source's key for the item, opaque to the caller. */
    externalKey: z.string().min(1),
    /** The source's name for the item. */
    name: z.string(),
    /** The source's link between versions of the item, opaque to the caller, or `null` when it has none. */
    lineageKey: z.string().nullable(),
});

export type RemoteSearchItem = z.infer<typeof remoteSearchItemSchema>;

/** `200`, shared for 7 days: the source's hits for the query, in the source's order. */
export const remoteSearchFoundSchema = z.object({
    outcome: z.literal('found'),
    items: z.array(remoteSearchItemSchema).min(1),
});

/** `200`, shared for 1 day: the source has nothing for the query. */
export const remoteSearchEmptySchema = z.object({ outcome: z.literal('empty') });

/** The `200` body: what the source said, which a cache may keep. */
export const remoteSearchAnswerSchema = z.discriminatedUnion('outcome', [
    remoteSearchFoundSchema,
    remoteSearchEmptySchema,
]);

export type RemoteSearchAnswer = z.infer<typeof remoteSearchAnswerSchema>;

/** A `200`, never stored: a miss asked with `admit=0`. The source was not called. */
export const remoteSearchNotAdmittedSchema = z.object({ outcome: z.literal('notAdmitted') });

export type RemoteSearchNotAdmitted = z.infer<typeof remoteSearchNotAdmittedSchema>;

/** A request parameter a `400` names. */
export const remoteSearchParameterSchema = z.enum(['q', 'admit', 'rid']);

export type RemoteSearchParameter = z.infer<typeof remoteSearchParameterSchema>;

/**
 * Every error body, never stored. `code` is the discriminant; `message` is for a log, not for a branch.
 *
 * `SOURCE_ERROR` carries the status the source answered with, so the caller applies its own block rule (ADR-0053 §5)
 * to the source's own signal.
 */
export const remoteSearchErrorSchema = z.discriminatedUnion('code', [
    z.object({
        /** `400`: a parameter is missing, repeated or malformed. */
        code: z.literal('INVALID_REQUEST'),
        message: z.string(),
        details: z.object({ parameter: remoteSearchParameterSchema }),
    }),
    z.object({
        /** `502`: the source answered with a status that is not a success. */
        code: z.literal('SOURCE_ERROR'),
        message: z.string(),
        details: z.object({ sourceStatus: z.number().int().min(100).max(599) }),
    }),
    z.object({
        /**
         * `404` NOT_FOUND: no search at this path. `405` METHOD_NOT_ALLOWED: not a `GET`. `502` SOURCE_INVALID_RESPONSE:
         * the source's body did not have the shape it publishes. `504` SOURCE_TIMEOUT: the source did not answer in
         * time. `500` INTERNAL: this service failed.
         */
        code: z.literal(['NOT_FOUND', 'METHOD_NOT_ALLOWED', 'SOURCE_INVALID_RESPONSE', 'SOURCE_TIMEOUT', 'INTERNAL']),
        message: z.string(),
    }),
]);

export type RemoteSearchError = z.infer<typeof remoteSearchErrorSchema>;
