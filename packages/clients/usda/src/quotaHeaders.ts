/**
 * The response headers in which api.data.gov reports the API key's own quota, on every response (plan U26). They are
 * the only count that sees the key's other users. Named in the register's own field names, so food-service's source
 * register declares them by spreading this.
 *
 * @module
 */

/** The api.data.gov rate-limit headers. */
export const USDA_QUOTA_HEADERS = Object.freeze({
    remainingHeader: 'X-RateLimit-Remaining',
    limitHeader: 'X-RateLimit-Limit',
} as const);
