/**
 * Unit tests for the app's composed query retry policy.
 *
 * The owner predicates are proved in their own packages; what belongs HERE is the composition itself, and it
 * has three properties worth failing on:
 *
 *  1. a veto from ANY owner is a veto (conjunction, not "the first one that recognises it");
 *  2. an error NO owner recognises still retries — the abstention default, which is what keeps the Clerk
 *     hydration-window recovery working;
 *  3. the attempt CAP is applied independently of the classification, so a permanently-failing 5xx still
 *     stops instead of retrying forever.
 */
import {
    FetchUnavailableError as FoodFetchUnavailableError,
    NotFoundError as FoodNotFoundError,
    RateLimitedError as FoodRateLimitedError,
    RequesterLimitReachedError,
    SourceBusyError,
} from '@kitchensink/food-service-client';
import { NotFoundError as RecipeNotFoundError, UnexpectedResponseError } from '@kitchensink/recipe-service-client';
import { NotFoundError as ProfileNotFoundError } from '@commise/features-account';
import { describe, expect, it } from 'vitest';

import {
    MAX_MUTATION_RETRY_WAIT_SECONDS,
    MAX_QUERY_RETRIES,
    retryAfterDelayMs,
    shouldRetryMutation,
    shouldRetryQuery,
} from '../retryPolicy.js';

describe('shouldRetryQuery — a veto from any owner is a veto', () => {
    it('refuses to retry a RECIPE-service 404', () => {
        expect(shouldRetryQuery(0, new RecipeNotFoundError())).toBe(false);
    });

    it('refuses to retry a FOOD-service 404', () => {
        // The apps call food-service directly (plan 002 S5), so its failures reach the same QueryClient.
        expect(shouldRetryQuery(0, new FoodNotFoundError('food_1'))).toBe(false);
    });

    it('refuses to retry a PROFILE-service 404', () => {
        // ⛔ Both hierarchies reach the ONE QueryClient each app mounts. A policy that only consulted the
        // recipe client would leave this one retrying three times with backoff — the same defect, one client
        // over, and invisible to any test that only exercised recipe errors.
        expect(shouldRetryQuery(0, new ProfileNotFoundError())).toBe(false);
    });
});

describe('shouldRetryQuery — transient failures keep retrying, up to the cap', () => {
    it('retries a 5xx', () => {
        // The assertion a blanket `retry: false` cannot pass.
        expect(shouldRetryQuery(0, new UnexpectedResponseError(500))).toBe(true);
    });

    it('retries a transport failure', () => {
        expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    });

    it('stops at the retry cap even for a failure it would otherwise retry forever', () => {
        const error = new UnexpectedResponseError(500);

        // `failureCount` is how many attempts have already FAILED, so the LAST retry worth granting is the
        // one asked for at `MAX_QUERY_RETRIES - 1`. Both boundaries are asserted: an off-by-one in either
        // direction silently changes how long every transient failure takes to give up.
        expect(shouldRetryQuery(0, error)).toBe(true);
        expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, error)).toBe(true);
        expect(shouldRetryQuery(MAX_QUERY_RETRIES, error)).toBe(false);
        expect(shouldRetryQuery(MAX_QUERY_RETRIES + 1, error)).toBe(false);
    });

    it('grants exactly TanStack’s own default number of retries, so only WHICH failures retry changed', () => {
        // ⛔ A regression guard on the OTHER axis. The bug being fixed is that a 4xx retried at all; if
        // this change also quietly moved the count, a later "why did retries get shorter?" would land on the
        // wrong commit. It also matters to the 401 carve-out, whose whole value is outlasting Clerk hydration.
        const granted = [0, 1, 2, 3, 4, 5].filter((n) => shouldRetryQuery(n, new UnexpectedResponseError(500)));

        expect(granted).toEqual([0, 1, 2]);
        expect(MAX_QUERY_RETRIES).toBe(3);
    });
});

describe('shouldRetryQuery — it abstains on errors no client owns', () => {
    it('retries the "Clerk has not minted a token yet" refusal, which belongs to no client hierarchy', () => {
        // ⛔ LOAD-BEARING, and fragile in exactly one direction. `RecipeProviders` throws
        // `RecipeAuthNotReadyError` from its token source during the Clerk hydration window and relies on the
        // query retry to recover it once hydration completes (`web/src/lib/recipeAuthNotReady.ts` records the
        // production failure that reasoning came from). Nothing here special-cases it — it survives because
        // both owners ABSTAIN. A future "unknown → do not retry" would break it silently.
        class RecipeAuthNotReadyError extends Error {}

        expect(shouldRetryQuery(0, new RecipeAuthNotReadyError('no token yet'))).toBe(true);
    });

    it.each([
        ['a plain Error', new Error('boom')],
        ['a thrown string', 'boom'],
        ['null', null],
        ['undefined', undefined],
        // A policy that sniffed `error.status` instead of using the typed guards would refuse this one.
        ['an unrelated object carrying a 404-looking status', { status: 404 }],
    ])('retries %s', (_label, value) => {
        expect(shouldRetryQuery(0, value)).toBe(true);
    });
});

describe('shouldRetryMutation — a write is retried ONLY when the server did not process it', () => {
    /**
     * ⛔ WHY THIS IS NOT `shouldRetryQuery`. A query is idempotent, so re-issuing it can only cost latency.
     * A mutation is not: `POST /api/v1/recipes` assigns its id server-side and accepts no idempotency key,
     * so a create re-issued after a 502 or a transport failure is a SECOND public recipe — the response
     * was lost, not the write. TanStack's default (mutations never retry) is the safe answer to that, and
     * it is why this predicate is separate rather than the query one reused.
     *
     * ⛔ AND WHY IT EXISTS AT ALL. That safe default meant a throttled write failed at the user. A 429 is
     * the one class where the server is telling us it did NOT process the request, so re-issuing cannot
     * duplicate anything — the same distinction `packages/tools/cookbook-import/src/RecipeApiClient.ts`
     * already draws ("a 429 or 503 is the server saying it did NOT process the request, so both are
     * retried on EVERY method").
     */
    it('retries a throttled write, such as a photo upload the throttler refused', () => {
        expect(shouldRetryMutation(0, new UnexpectedResponseError(429, 'Too Many Requests', 'TOO_MANY_REQUESTS'))).toBe(
            true,
        );
    });

    it('retries a write shed under backpressure', () => {
        expect(shouldRetryMutation(0, new UnexpectedResponseError(503, 'Service Unavailable'))).toBe(true);
    });

    it('REFUSES a write that may already have committed', () => {
        // 502/504 arrive when the upstream answered or timed out AFTER writing. Retrying duplicates.
        expect(shouldRetryMutation(0, new UnexpectedResponseError(502, 'Bad Gateway'))).toBe(false);
        expect(shouldRetryMutation(0, new UnexpectedResponseError(504, 'Gateway Timeout'))).toBe(false);
    });

    it('REFUSES a write the server considered and rejected', () => {
        expect(shouldRetryMutation(0, new UnexpectedResponseError(400, 'Bad Request'))).toBe(false);
        expect(shouldRetryMutation(0, new UnexpectedResponseError(403, 'Forbidden'))).toBe(false);
    });

    it('REFUSES a transport failure, which may also have committed', () => {
        expect(shouldRetryMutation(0, new TypeError('Failed to fetch'))).toBe(false);
    });

    // Plan 002 C5: the cook's own limit refuses every request until its window ends, so a retry inside it is refused
    // again, and each one holds the cook's action on a wait they were already told about.
    it('REFUSES the cook’s own limit, though it is a 429', () => {
        expect(shouldRetryMutation(0, new RequesterLimitReachedError(20))).toBe(false);
    });

    it('REFUSES a food 429, which food owns and says repeating cannot fix', () => {
        expect(shouldRetryMutation(0, new FoodRateLimitedError(20))).toBe(false);
    });

    it('REFUSES a food write that met a transport failure, which may have committed', () => {
        const transport = new FoodFetchUnavailableError(
            undefined,
            'Food service request failed',
            new TypeError('fetch'),
        );

        expect(shouldRetryMutation(0, transport)).toBe(false);
    });

    it('retries a refusal whose stated wait is at most the cap, which is 30 seconds', () => {
        expect(MAX_MUTATION_RETRY_WAIT_SECONDS).toBe(30);
        expect(shouldRetryMutation(0, new SourceBusyError(MAX_MUTATION_RETRY_WAIT_SECONDS))).toBe(true);
    });

    // A wait longer than the cap holds the cook's action past the point they would act again, so it is theirs to retry.
    it('REFUSES a refusal whose stated wait is longer than the cap', () => {
        expect(shouldRetryMutation(0, new SourceBusyError(MAX_MUTATION_RETRY_WAIT_SECONDS + 1))).toBe(false);
    });

    it('stops at the cap instead of retrying a throttle forever', () => {
        expect(shouldRetryMutation(MAX_QUERY_RETRIES, new UnexpectedResponseError(429, 'Too Many Requests'))).toBe(
            false,
        );
    });
});

describe('retryAfterDelayMs — the wait before a refused write is sent again', () => {
    it('waits the seconds the refusal states', () => {
        expect(retryAfterDelayMs(0, new SourceBusyError(7))).toBe(7_000);
    });

    it('backs off exponentially, capped at 30 seconds, when the refusal states no wait', () => {
        const throttled = new UnexpectedResponseError(429, 'Too Many Requests', 'TOO_MANY_REQUESTS');

        expect([0, 1, 2, 10].map((failures) => retryAfterDelayMs(failures, throttled))).toEqual([
            1_000, 2_000, 4_000, 30_000,
        ]);
    });

    it('backs off when the stated wait is zero, rather than sending again at once', () => {
        expect(retryAfterDelayMs(0, new SourceBusyError(0))).toBe(1_000);
    });
});
