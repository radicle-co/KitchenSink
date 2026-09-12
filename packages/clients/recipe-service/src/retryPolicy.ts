/**
 * This client's half of the app-wide TanStack Query retry policy: given a thrown value, is issuing the same
 * request again worth anything?
 *
 * WHY IT LIVES HERE. The knowledge being represented is "which of MY failures are transient", and the only
 * module that can answer that is the one that DEFINES them. Putting the classification anywhere else would
 * make it a second, unowned authority beside `errors.ts` — free to drift the moment a class is added — and a
 * central module importing both this hierarchy and `@commise/features-account`'s would collide on six
 * identically-named guards (`isNotFoundError`, `isBadRequestError`, …). The app composes the owners'
 * predicates instead; see `@commise/query`.
 *
 * ⛔ IT CAN ONLY VETO. Anything this module does not own answers `true` — abstention, not approval. That is
 * what lets the app compose several owners' predicates by conjunction with no shared vocabulary type between
 * them, and it is also what preserves an existing recovery: `RecipeAuthNotReadyError` (thrown by the web
 * provider's token source while Clerk is still hydrating, `web/src/lib/recipeAuthNotReady.ts`) belongs to no
 * client hierarchy, so nothing vetoes it and TanStack still retries it a moment later, exactly as that
 * module's docstring says it relies on. Do NOT "tighten" the default to `false`.
 *
 * ⛔ DISPATCH IS ON THE TYPE, NEVER ON A STATUS RANGE — the two are not interchangeable here, and two of this
 * hierarchy's classes prove it: `InvalidRequestError` and `FetchUnavailableError` BOTH carry no
 * status and sit at opposite extremes (a body that was never sent and can never succeed vs. a timeout that is
 * the textbook retry). A `status >= 400 && status < 500` rule cannot separate them, and it also gets `429`
 * backwards. `status` is read in exactly ONE branch — `UnexpectedResponseError`, whose entire contract
 * is "a status I have no dedicated class for", so there the status is the only information the value carries
 * by design.
 *
 * ⛔ `401` IS CLASSIFIED TRANSIENT, deliberately, against the general "never retry a 4xx" rule
 * (`docs/engineering/ENGINEERING_EXCELLENCE.md`). That rule assumes the request's inputs are constant across
 * attempts, and here they are not: the CREDENTIAL is re-minted between them. This is not a new exception —
 * it is `specs/governance-rules.md` GR-018-a's ratified `signature` case one layer over, where a rejection
 * caused by OUR OWN stale-or-unminted secret is "transient and operator-fixable" rather than a verdict on
 * the caller.
 *
 * ⚠️ THE FLIP CONDITION, stated so it can actually be checked. Two token sources REACHED BY A RETRYABLE
 * QUERY still resolve an EMPTY bearer during the Clerk hydration window, which the service answers `401`:
 * `mobile/src/providers/RecipeServiceGate.tsx` and `web/src/hooks/useUserProfile.ts`. Seven further `?? ''`
 * sources exist and are deliberately NOT counted, each for a reason this policy cannot reach: five SSR
 * prefetch pages plus `[locale]/{account,profile}/page.tsx` run on a bare server-side client whose retry
 * default is `0`, and `web/src/components/auth/useEraseAccount.ts` is a MUTATION, which is never retried.
 * Count them before flipping — an audit of only the two named here would leave the hole open.
 *
 * `recipeAuthNotReady.ts` records what happens when the window is not outlasted: a transient pre-hydration
 * state reaching the redirect-to-sign-in handler as a user-visible auth failure, measured in production
 * 2026-08-07. The client's own internal replay is immediate and un-backed-off, so the query-level backoff is
 * the only thing that spans it. Flip this only AFTER no query-reached token source can send an empty bearer
 * — the end state is to make that unrepresentable, exactly as `RecipeProviders` already does by throwing
 * `RecipeAuthNotReadyError` instead, at which point this carve-out deletes itself.
 *
 * ⚠️ ACCEPTED COST, in the unit that matters. The client's own `401` handling (an identity-sync backoff of
 * up to 3 attempts, plus one forced-refresh replay) now MULTIPLIES with the query-level retry, so a
 * genuinely signed-out caller can spend roughly 8 requests over ~7s before the redirect handler sees the
 * `401`. That is the same shape as the defect this module removes, on a rarer path, and it is the price of
 * not re-creating the 2026-08-07 incident.
 *
 * @pattern Specification — a pure predicate over a failure, composed by conjunction with the other clients'.
 */
import {
    isBadRequestError,
    isFetchUnavailableError,
    isForbiddenError,
    isGoneError,
    isInvalidRequestError,
    isNotFoundError,
    isParseJobExpiredError,
    isPullDriftError,
    isRecipeServiceClientError,
    isSourceBusyError,
    isSourceUnavailableError,
    isUnauthorizedError,
    isUnexpectedResponseError,
    isVersionConflictError,
} from './errors.js';

/**
 * Statuses that are 4xx yet genuinely worth coming back for: the request timed out at the server (`408`),
 * arrived too early to be replayed safely (`425`), or was rate-refused (`429`). Everything else in the 4xx
 * range names something about the request itself, which repeating cannot change.
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
 * @param error - The value a recipe-service query rejected with. Any type; foreign values abstain.
 * @returns `false` only for a failure THIS client owns that repeating cannot fix; `true` otherwise.
 */
export function shouldRetryRecipeServiceFailure(error: unknown): boolean {
    // The caller's own body never satisfied the published contract, so no request went out and the same body
    // cannot start working. Checked FIRST because it carries no status and must not reach the status branch.
    if (isInvalidRequestError(error)) {
        return false;
    }

    // Nothing answered — a timeout or an aborted connection. Also status-less, and the opposite answer.
    if (isFetchUnavailableError(error)) {
        return true;
    }

    // See the module docstring: the credential is re-minted between attempts, so this one is not constant.
    if (isUnauthorizedError(error)) {
        return true;
    }

    // The upstream ingredient source refused on rate or failed to answer — both are its own transient state.
    if (isSourceBusyError(error) || isSourceUnavailableError(error)) {
        return true;
    }

    // Terminal by contract: the request named something that is wrong, absent, forbidden, stale or expired.
    if (
        isBadRequestError(error) ||
        isForbiddenError(error) ||
        isNotFoundError(error) ||
        isVersionConflictError(error) ||
        isPullDriftError(error) ||
        isGoneError(error) ||
        isParseJobExpiredError(error)
    ) {
        return false;
    }

    // The unmapped-status class, and the base class for a failure with no dedicated subclass. This is the one
    // branch where the status IS the classification, because it is all the value carries.
    if (isUnexpectedResponseError(error) || isRecipeServiceClientError(error)) {
        return isTransientStatus(error.status);
    }

    // Not ours. Abstain — see the module docstring; this default is load-bearing.
    return true;
}
