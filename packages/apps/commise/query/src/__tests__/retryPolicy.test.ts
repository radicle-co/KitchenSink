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
import { NotFoundError as RecipeNotFoundError, UnexpectedResponseError } from '@kitchensink/recipe-service-client';
import { NotFoundError as ProfileNotFoundError } from '@commise/features-account';
import { describe, expect, it } from 'vitest';

import { MAX_QUERY_RETRIES, shouldRetryMutation, shouldRetryQuery } from '../retryPolicy.js';

describe('shouldRetryQuery — a veto from any owner is a veto', () => {
    it('refuses to retry a RECIPE-service 404', () => {
        expect(shouldRetryQuery(0, new RecipeNotFoundError())).toBe(false);
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
    it('retries a throttled write', () => {
        expect(shouldRetryMutation(0, new UnexpectedResponseError(429, 'Too Many Requests'))).toBe(true);
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

    it('stops at the cap instead of retrying a throttle forever', () => {
        expect(shouldRetryMutation(MAX_QUERY_RETRIES, new UnexpectedResponseError(429, 'Too Many Requests'))).toBe(
            false,
        );
    });
});
