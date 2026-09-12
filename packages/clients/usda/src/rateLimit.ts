/**
 * Reader for USDA FoodData Central's `X-RateLimit-*` response headers (U38).
 *
 * FoodData Central reports the api.data.gov quota on every response. The food service also runs a
 * rolling-60-minute counter in Postgres over `source_call_log` — that counter MODELS the same number,
 * and it is the thing that decides admission, so it stays. What it cannot answer is whether the quota is
 * charged per API key or per egress IP: our count and the server's `remaining` agree under one reading
 * and diverge under the other. Reading the header settles that empirically rather than by argument.
 *
 * ⚠️ Absence is not an error and must not be papered over. A header USDA did not send, or sent in a form
 * we cannot read, is reported as absent — never as `0`, which on a chart is indistinguishable from an
 * exhausted quota, and never as `NaN`, which poisons every aggregate downstream.
 */

/** The `X-RateLimit-*` reading from one USDA response; a field is present only when USDA reported it. */
export interface UsdaRateLimitSnapshot {
    /** `X-RateLimit-Limit` — the quota the server says the window holds. */
    readonly limit?: number;
    /** `X-RateLimit-Remaining` — the calls the server says are left in the window. */
    readonly remaining?: number;
}

/**
 * The minimum a header bag must offer to be read. Typed structurally rather than as `Headers` because
 * `fetch` is injectable on this client: a caller's double may supply less than a real `Response` does.
 */
export interface HeaderBag {
    /** Case-insensitive header lookup, `null` when absent (the `Headers.get` contract). */
    get(name: string): string | null;
}

/** The header carrying the quota's size. */
const LIMIT_HEADER = 'X-RateLimit-Limit';

/** The header carrying the calls left in the quota. */
const REMAINING_HEADER = 'X-RateLimit-Remaining';

/** A non-negative decimal integer and nothing else — no sign, no exponent, no fractional part. */
const NON_NEGATIVE_INTEGER = /^\d+$/;

/**
 * Parse one header value as a non-negative integer count. Pure.
 *
 * @param raw - The header value, or `null` when the header was absent.
 * @returns The count, or `undefined` when absent or not a non-negative integer.
 */
function readCount(raw: string | null): number | undefined {
    if (raw === null) {
        return undefined;
    }

    const trimmed = raw.trim();

    // `Number('')` is 0 and `Number('1e3')` is 1000 — both are readings USDA never sent, so the shape is
    // checked before the conversion rather than after it.
    return NON_NEGATIVE_INTEGER.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * Read the rate-limit snapshot from a response's headers. Pure.
 *
 * @param headers - The response headers (`undefined` when the response carried none).
 * @returns The snapshot, or `undefined` when neither header was present and readable.
 */
export function readRateLimitHeaders(headers: HeaderBag | undefined): UsdaRateLimitSnapshot | undefined {
    if (headers === undefined) {
        return undefined;
    }

    const limit = readCount(headers.get(LIMIT_HEADER));
    const remaining = readCount(headers.get(REMAINING_HEADER));

    if (limit === undefined && remaining === undefined) {
        return undefined;
    }

    return {
        ...(limit !== undefined ? { limit } : {}),
        ...(remaining !== undefined ? { remaining } : {}),
    };
}
