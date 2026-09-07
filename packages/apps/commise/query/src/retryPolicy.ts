/**
 * The app's composed TanStack Query retry decision — one authoritative representation, consumed by BOTH
 * platforms' composition roots (`web/src/components/recipes/RecipeProviders.tsx`,
 * `mobile/src/providers/AppProviders.tsx`).
 *
 * WHAT WAS WRONG. Both roots built a bare `new QueryClient()`, so TanStack's default `retry: 3` with
 * exponential backoff applied to EVERY failure — including a `404`. A cook following a dead or deleted
 * recipe link waited ~7s on backoff before seeing anything, and the API absorbed four requests to say "no".
 * A `4xx` is not a transient failure: repeating it cannot succeed, so the retry was pure latency and pure
 * load. `5xx` and transport failures must keep retrying, which is why the fix is a predicate rather than
 * `retry: false`.
 *
 * WHERE THE KNOWLEDGE LIVES. Not here. Each client package classifies its OWN failures, beside the
 * `errors.ts` that defines them — `shouldRetryRecipeServiceFailure` and `shouldRetryProfileServiceFailure`.
 * This module only COMPOSES them, for two reasons: the classification cannot drift from the hierarchy it
 * describes if it ships with it, and the two hierarchies export six identically-named guards
 * (`isNotFoundError`, `isBadRequestError`, …) so a single module reading both would have to alias every one.
 *
 * ⛔ COMPOSITION IS CONJUNCTION, AND EVERY OWNER ABSTAINS ON WHAT IT DOES NOT OWN. Each predicate can only
 * VETO; an error nobody recognises is retried. That default is load-bearing, not laziness: `RecipeProviders`
 * throws `RecipeAuthNotReadyError` from its token source while Clerk is still hydrating and relies on the
 * query retry to recover once it has (see `web/src/lib/recipeAuthNotReady.ts`, which records the production
 * failure that reasoning came from). Nothing here special-cases it; it survives because both owners abstain.
 * Do NOT "tighten" the default to `false`, and do NOT reorder this into "the first owner that recognises it
 * decides" — conjunction is what makes adding a third client one more conjunct instead of a re-think.
 *
 * @pattern Composite Specification — the owners' pure predicates folded with AND, with vacuous abstention.
 */
import { shouldRetryProfileServiceFailure } from '@commise/features-account';
import { shouldRetryRecipeServiceFailure } from '@kitchensink/recipe-service-client';

/**
 * How many RETRIES a transient failure is allowed — so four attempts in all, the first plus these.
 *
 * ⛔ Deliberately TanStack's own default, unchanged. This fix is about WHICH failures retry, not how many
 * times: moving both at once would make a regression in either indistinguishable from a fix to the other, and
 * would quietly shorten the window that covers the Clerk hydration race the `401` carve-out depends on.
 * It is a RETRY count, not an attempt count, because that is the number TanStack's `retry` option takes and
 * the number `failureCount` is compared against — naming it "attempts" is how an off-by-one gets shipped.
 */
export const MAX_QUERY_RETRIES = 3;

/**
 * Every owner's veto, in the order they are asked (which does not matter — conjunction commutes; it is
 * written as an array so adding a client is one line and cannot change the shape of the fold).
 */
const RETRY_VETOES: ReadonlyArray<(error: unknown) => boolean> = [
    shouldRetryRecipeServiceFailure,
    shouldRetryProfileServiceFailure,
];

/**
 * Whether TanStack Query should attempt a failed query again.
 *
 * Pure — a decision over a count and a value, no I/O and no clock. Shaped to TanStack's `retry` predicate.
 *
 * @param failureCount - How many attempts have already FAILED (TanStack passes `0` before the first retry).
 * @param error - The value the query rejected with.
 * @returns `true` when another attempt is both within the cap and worth making.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    if (failureCount >= MAX_QUERY_RETRIES) {
        return false;
    }

    return RETRY_VETOES.every((isRetryable) => isRetryable(error));
}

/**
 * The statuses that mean the server did NOT process the request, so re-issuing cannot duplicate its effect.
 *
 * `429` is our own `UserThrottlerGuard` refusing on rate; `503` is a service shedding load. Both are
 * answered before any write happens, which is what makes them safe on a non-idempotent method.
 */
const NOT_PROCESSED_STATUSES: readonly number[] = [429, 503];

/**
 * Whether TanStack Query should attempt a failed MUTATION again.
 *
 * ⛔ DELIBERATELY NARROWER THAN {@link shouldRetryQuery}, and the difference is not caution for its own
 * sake. A query is idempotent, so replaying it costs latency. A mutation is not: `POST /api/v1/recipes`
 * assigns its id server-side and accepts no idempotency key, so a create replayed after a `502` or a
 * dropped socket is a SECOND recipe — those failures can FOLLOW a commit, with only the response lost.
 * TanStack's default of never retrying a mutation is the correct answer to that, and this predicate keeps
 * it for every class except the one where the server has told us it did nothing.
 *
 * ⚠️ WHY IT EXISTS. That safe default meant a throttled write surfaced to the user as a failed action.
 * Filling a recipe to `MAX_RECIPE_PHOTOS` issues two requests per photo, so a cook could reach the photo
 * budget in a single sitting and see uploads fail rather than wait. The same distinction is already drawn
 * in `packages/tools/cookbook-import/src/RecipeApiClient.ts`, whose transport retries `429`/`503` on every
 * method for exactly this reason; this is that rule, in the app.
 *
 * Pure — a decision over a count and a value, no I/O and no clock.
 *
 * @param failureCount - How many attempts have already FAILED.
 * @param error - The value the mutation rejected with.
 * @returns `true` only for a bounded retry of a request the server refused without processing.
 */
export function shouldRetryMutation(failureCount: number, error: unknown): boolean {
    if (failureCount >= MAX_QUERY_RETRIES) {
        return false;
    }

    const status: unknown = (error as { readonly status?: unknown } | null)?.status;

    return typeof status === 'number' && NOT_PROCESSED_STATUSES.includes(status);
}

/**
 * How long to wait before re-issuing a refused request.
 *
 * ⛔ HONOURS THE SERVER'S OWN `Retry-After` WHEN IT IS KNOWN. A client that ignores it turns a queue into a
 * stampede: every throttled caller returns at the same moment the window opens. When the error carries no
 * hint, fall back to capped exponential backoff — TanStack's own default shape.
 *
 * ⚠️ TODAY ONLY `SourceBusyError` CARRIES `retryAfterSeconds`. Our own throttler's `429` surfaces without
 * one, so it takes the backoff path. Teaching the client to parse the `Retry-After` header on a throttled
 * response is a separate change in `@kitchensink/recipe-service-client`; this function is already shaped to
 * use it the day it lands, and the backoff is a safe answer in the meantime.
 *
 * Pure — arithmetic over a count and a value.
 *
 * @param failureCount - How many attempts have already failed.
 * @param error - The value the request rejected with.
 * @returns Milliseconds to wait before the next attempt.
 */
export function retryAfterDelayMs(failureCount: number, error: unknown): number {
    const hinted: unknown = (error as { readonly retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;

    if (typeof hinted === 'number' && Number.isFinite(hinted) && hinted > 0) {
        return hinted * 1000;
    }

    return Math.min(1000 * 2 ** failureCount, 30_000);
}
