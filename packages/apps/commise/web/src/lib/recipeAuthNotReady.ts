/**
 * The typed "Clerk has not produced a session token yet" condition for the recipe service client.
 *
 * WHY THIS EXISTS. `RecipeProviders` used to hand the client an EMPTY string when no token was
 * available — `typeof getToken !== 'function'` during SSR/pre-hydration, or `getToken()` resolving
 * `null` — with the stated intent of sending the request "unauthenticated rather than throwing inside
 * the request pipeline". An empty bearer is not a degraded credential, it is a guaranteed failure:
 * every protected recipe endpoint answers `401 {"message":"Missing bearer token"}`.
 *
 * Observed in production 2026-08-07: on a signed-in Home load,
 * `GET recipe.commise.app/api/v1/recipes?pageSize=4` returned 401 while the identical request carrying
 * a real token returned 200. That 401 then met the app's redirect-to-sign-in handler, which is how a
 * transient pre-hydration state became a user-visible auth failure.
 *
 * Making the state REPRESENTABLE instead of faking a credential is the fix. A thrown typed error is
 * recovered by TanStack Query's default retry once hydration completes, so the transient case
 * self-heals — and, critically, no request is issued that cannot succeed, so there is no 401 for any
 * redirect handler to react to. Distinguishing "not ready yet" from "the server rejected you" is the
 * whole point; an empty bearer collapses them into the same observable outcome.
 */

/** Thrown when a recipe request is attempted before Clerk can mint a session token. */
export class RecipeAuthNotReadyError extends Error {
    public constructor(message = 'Clerk has not produced a session token yet') {
        super(message);
        this.name = 'RecipeAuthNotReadyError';
        Object.setPrototypeOf(this, RecipeAuthNotReadyError.prototype);
    }
}

/**
 * Type guard for {@link RecipeAuthNotReadyError}.
 *
 * @param error - The value to test.
 * @returns `true` when it is a not-ready refusal rather than a server rejection.
 */
export function isRecipeAuthNotReadyError(error: unknown): error is RecipeAuthNotReadyError {
    return error instanceof RecipeAuthNotReadyError;
}
