/**
 * The profile client's half of the app-wide TanStack Query retry policy: given a thrown value, is issuing the
 * same request again worth anything?
 *
 * The MIRROR of `@kitchensink/recipe-service-client`'s `retryPolicy.ts`, and it exists for the same reason
 * that module does — only the module that DEFINES a failure can say whether repeating it helps — plus one
 * that is specific to this app: both hierarchies reach the ONE `QueryClient` each platform mounts, and they
 * export six identically-named guards (`isNotFoundError`, `isBadRequestError`, `isUnauthorizedError`,
 * `isForbiddenError`, `isUnexpectedResponseError`, `isInvalidRequestError`). A single central module reading
 * both would have to alias every one of them, which is the code saying the classification does not belong in
 * one place. The app composes the two predicates instead; see `@commise/query`.
 *
 * ⛔ IT CAN ONLY VETO — anything it does not own answers `true`. See the recipe client's module docstring for
 * why that default is load-bearing rather than lazy.
 *
 * ⛔ `401` IS CLASSIFIED TRANSIENT, and the reason is sharper on this client than on the recipe one:
 * `web/src/hooks/useUserProfile.ts` builds its bearer as `(await getToken()) ?? ''` and enables the query on
 * `isSignedIn`, which `@clerk/nextjs` reports `true` throughout the pre-clerk-js window (it feeds
 * `deriveState` an SSR `initialState`). So during hydration this client really does send an empty bearer and
 * really does get a `401` that is nothing to do with the caller's identity. The credential is re-minted
 * between attempts, so the request is not constant across them and the general "never retry a 4xx" rule does
 * not apply — this is `specs/governance-rules.md` GR-018-a's ratified `signature` case, where a rejection
 * caused by OUR OWN stale-or-unminted secret is transient rather than a verdict on the caller. The full flip
 * condition (and the seven further `?? ''` sources this policy deliberately does NOT count) is written out
 * once, in `@kitchensink/recipe-service-client`'s sibling module. Flip both together or neither.
 *
 * @pattern Specification — a pure predicate over a failure, composed by conjunction with the other clients'.
 */
import {
    isBadRequestError,
    isForbiddenError,
    isInvalidRequestError,
    isNotFoundError,
    isProfileServiceClientError,
    isUnauthorizedError,
    isUnexpectedResponseError,
} from './errors.js';

/**
 * Statuses that are 4xx yet genuinely worth coming back for — the server timed out (`408`), the request
 * arrived too early to replay safely (`425`), or it was rate-refused (`429`).
 *
 * ⚠️ Stated again here rather than shared with the recipe client's copy, and the honest argument is
 * CONTAINMENT rather than the third-occurrence heuristic — by the repo's own DRY test these two fragments
 * genuinely ARE one piece of knowledge (HTTP's semantics) and would change for the same reason, so
 * "different reasons to change" does not excuse them. What does: every guard in both hierarchies is
 * `instanceof`-based, so this predicate abstains on a recipe `UnexpectedResponseError` and the recipe one
 * abstains on a profile error. A drift in one copy therefore cannot reach the other client's queries through
 * the composition — the blast radius is this package. ⛔ That argument dies the day a guard becomes
 * duck-typed; extract to a shared module in the same change if one ever does.
 */
const TRANSIENT_CLIENT_ERROR_STATUSES: readonly number[] = [408, 425, 429];

/**
 * Whether a status the client has no dedicated error class for is worth retrying.
 *
 * @param status - The HTTP status, or `undefined` when nothing answered.
 * @returns `true` unless the status says the request itself is the problem.
 */
function isTransientStatus(status: number | undefined): boolean {
    if (status === undefined) {
        return true;
    }

    if (TRANSIENT_CLIENT_ERROR_STATUSES.includes(status)) {
        return true;
    }

    return status < 400 || status >= 500;
}

/**
 * Whether re-issuing the request that produced `error` could plausibly succeed.
 *
 * Pure — a classification over a value, no I/O and no clock.
 *
 * @param error - The value a profile-service query rejected with. Any type; foreign values abstain.
 * @returns `false` only for a failure THIS client owns that repeating cannot fix; `true` otherwise.
 */
export function shouldRetryProfileServiceFailure(error: unknown): boolean {
    // The caller's own body never satisfied the published contract, so no request went out. Checked FIRST
    // because it carries no status and must not fall through to the status branch, which would retry it.
    if (isInvalidRequestError(error)) {
        return false;
    }

    // See the module docstring: the credential is re-minted between attempts, so this is not the same request.
    if (isUnauthorizedError(error)) {
        return true;
    }

    // Terminal by contract: the request named something wrong, absent, or forbidden.
    if (isBadRequestError(error) || isForbiddenError(error) || isNotFoundError(error)) {
        return false;
    }

    // The unmapped-status class, and the base class for a failure with no dedicated subclass. The ONE branch
    // where the status IS the classification, because it is all the value carries.
    if (isUnexpectedResponseError(error) || isProfileServiceClientError(error)) {
        return isTransientStatus(error.status);
    }

    // Not ours. Abstain.
    return true;
}
