/**
 * This client's half of the app-wide TanStack Query retry policy: given a thrown value, is sending the same request
 * again worth anything? The apps call food-service directly (plan 002 S5), so its failures reach the one `QueryClient`
 * each app mounts, and `@commise/query` folds this rule with the other clients' by AND.
 *
 * It can only VETO, it decides on the error's TYPE, and it abstains (answers `true`) on a value it does not own, for
 * the reasons `@kitchensink/recipe-service-client`'s `retryPolicy.ts` states for its own half. A refused token is
 * transient for the reason given there too: the client replays a refused request only when a fresh mint gives a
 * different token (`@kitchensink/retry-after/bearer-replay`), and on mobile the bearer stays empty until Clerk loads, so
 * only the query's backoff outlasts that window.
 *
 * @pattern Specification — a pure predicate over a failure, composed by conjunction with the other clients'
 */
import {
    isBadRequestError,
    isCandidateMismatchError,
    isConflictError,
    isFetchUnavailableError,
    isFoodServiceClientError,
    isForbiddenError,
    isInvalidRequestError,
    isNotFoundError,
    isRateLimitedError,
    isUnauthorizedError,
} from './errors.js';

/**
 * Statuses in the 4xx range that a later attempt may still get past: the request timed out at the server (`408`) or
 * arrived too early to be replayed (`425`). A `429` is not here: it always maps to a {@link isRateLimitedError} class.
 */
const TRANSIENT_CLIENT_ERROR_STATUSES: readonly number[] = [408, 425];

/**
 * Whether a status this client has no dedicated error class for is worth another attempt.
 *
 * @param status - The HTTP status, or `undefined` when nothing answered.
 * @returns `true` unless the status says the request itself is the problem. Pure.
 */
function isTransientStatus(status: number | undefined): boolean {
    if (status === undefined || TRANSIENT_CLIENT_ERROR_STATUSES.includes(status)) {
        return true;
    }

    return status < 400 || status >= 500;
}

/**
 * Whether sending the request that produced `error` again could plausibly succeed.
 *
 * @param error - The value a food-service call rejected with. Any type; a value this client does not own abstains.
 * @returns `false` only for a failure this client owns that repeating cannot fix; `true` otherwise. Pure.
 */
export function shouldRetryFoodServiceFailure(error: unknown): boolean {
    // Never sent: the caller's own input broke the published contract, so the same input cannot start working.
    if (isInvalidRequestError(error)) {
        return false;
    }

    // Nothing answered, food answered busy, or the token was refused (see the module docstring): each may answer next
    // time.
    if (isFetchUnavailableError(error) || isUnauthorizedError(error)) {
        return true;
    }

    // Every 429 is a per-caller limit that refuses every request until its window ends.
    if (isRateLimitedError(error)) {
        return false;
    }

    // Terminal by contract: the request named something malformed, absent, forbidden or not in its state.
    if (
        isBadRequestError(error) ||
        isNotFoundError(error) ||
        isForbiddenError(error) ||
        isConflictError(error) ||
        isCandidateMismatchError(error)
    ) {
        return false;
    }

    // What is left of this client's errors (`UnexpectedResponseError`, and the base class) carries nothing but a status,
    // so the status decides.
    if (isFoodServiceClientError(error)) {
        return isTransientStatus(error.status);
    }

    // Not ours: abstain.
    return true;
}
