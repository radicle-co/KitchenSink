/**
 * The retry POLICY of the recipe transport — specifically, which failures a NON-idempotent call may retry.
 *
 * `POST /api/v1/recipes` has no idempotency key (the ledger's own docblock says so), so a POST re-issued
 * after the service committed the row is a second public recipe, and the ledger — which records the id the
 * CLIENT was handed back — never learns about the first one. Three failure shapes can follow a commit: a
 * `502`/`504` from the ALB (the upstream answered, or timed out, AFTER writing), a transport failure while
 * the response was being read, and a `2xx` whose body fails the published schema. None of them may be
 * retried for a POST. `429` and `503` are the server saying it did NOT process the request, and stay
 * retryable; a GET is idempotent and retries everything transient.
 *
 * `fetch` is stubbed on the global, and p-retry's backoff runs on fake timers so a retrying case does not
 * wait out `minTimeout`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeApiClient } from '../RecipeApiClient.js';
import { isRecipeApiError } from '../RecipeApiError.js';

/** A catalog row the published `ingredientSchema` accepts. */
const INGREDIENT = {
    id: 'ing_01J0000000000000000000000',
    name: 'salt',
    isUserEntered: true,
    createdAt: '2026-09-03T00:00:00.000Z',
};

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

/** Install a `fetch` double answering in sequence, and return the spy. */
function fetchAnswering(...answers: readonly (Response | Error)[]): ReturnType<typeof vi.fn> {
    const queue = [...answers];
    const double = vi.fn(async () => {
        const next = queue.shift();

        if (next === undefined) {
            throw new Error('fetch called more times than the test scripted');
        }

        if (next instanceof Error) {
            throw next;
        }

        return next;
    });

    vi.stubGlobal('fetch', double);

    return double;
}

const client = () => new RecipeApiClient({ baseUrl: 'http://recipe.local', token: 'tok' });

describe('RecipeApiClient retry policy', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    /**
     * Each case scripts a SUCCESS as the second answer and then advances the clock past the backoff, so a
     * policy that retries is caught by the assertion ("2 calls, and it resolved") rather than by a timeout.
     */
    describe('a POST is never re-issued after the request may have been processed', () => {
        it('does NOT retry a POST the gateway answered 502 — the upstream may have committed', async () => {
            const fetchDouble = fetchAnswering(answer(502, 'Bad Gateway'), answer(201, INGREDIENT));

            const settled = client()
                .createFreeformIngredient('salt')
                .catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(5_000);
            const failure = await settled;

            expect(fetchDouble).toHaveBeenCalledTimes(1);
            expect(isRecipeApiError(failure) && failure.status).toBe(502);
        });

        it('does NOT retry a POST the gateway answered 504 — a timed-out upstream may still finish the write', async () => {
            const fetchDouble = fetchAnswering(answer(504, 'Gateway Timeout'), answer(201, INGREDIENT));

            const settled = client()
                .createFreeformIngredient('salt')
                .catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(5_000);
            const failure = await settled;

            expect(fetchDouble).toHaveBeenCalledTimes(1);
            expect(isRecipeApiError(failure) && failure.status).toBe(504);
        });

        it('does NOT retry a POST after a transport failure — the request may have left before the socket died', async () => {
            const fetchDouble = fetchAnswering(new TypeError('fetch failed'), answer(201, INGREDIENT));

            const settled = client()
                .createFreeformIngredient('salt')
                .catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(5_000);
            const failure = await settled;

            expect(fetchDouble).toHaveBeenCalledTimes(1);
            expect(isRecipeApiError(failure) && failure.status).toBe(0);
        });

        it('does NOT retry a POST whose 2xx body fails the published contract — the row EXISTS', async () => {
            const fetchDouble = fetchAnswering(answer(201, { not: 'an ingredient' }), answer(201, INGREDIENT));

            const settled = client()
                .createFreeformIngredient('salt')
                .catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(5_000);
            const failure = await settled;

            expect(fetchDouble).toHaveBeenCalledTimes(1);
            expect(failure).toBeInstanceOf(Error);
        });
    });

    describe('what the server says it did not process is still retried', () => {
        it('retries a POST the throttler answered 429', async () => {
            const fetchDouble = fetchAnswering(answer(429, { code: 'RATE_LIMITED' }), answer(201, INGREDIENT));

            const outcome = client().createFreeformIngredient('salt');
            await vi.advanceTimersByTimeAsync(5_000);

            await expect(outcome).resolves.toMatchObject({ id: INGREDIENT.id });
            expect(fetchDouble).toHaveBeenCalledTimes(2);
        });

        it('retries a POST the service shed with 503', async () => {
            const fetchDouble = fetchAnswering(answer(503, { code: 'FETCH_UNAVAILABLE' }), answer(201, INGREDIENT));

            const outcome = client().createFreeformIngredient('salt');
            await vi.advanceTimersByTimeAsync(5_000);

            await expect(outcome).resolves.toMatchObject({ id: INGREDIENT.id });
            expect(fetchDouble).toHaveBeenCalledTimes(2);
        });

        it('retries a GET the gateway answered 502 — a read is idempotent', async () => {
            const fetchDouble = fetchAnswering(answer(502, 'Bad Gateway'), answer(200, INGREDIENT));

            const outcome = client().getIngredientStatus(INGREDIENT.id);
            await vi.advanceTimersByTimeAsync(5_000);

            await expect(outcome).resolves.toMatchObject({ id: INGREDIENT.id });
            expect(fetchDouble).toHaveBeenCalledTimes(2);
        });

        it('retries a GET after a transport failure', async () => {
            const fetchDouble = fetchAnswering(new TypeError('fetch failed'), answer(200, INGREDIENT));

            const outcome = client().getIngredientStatus(INGREDIENT.id);
            await vi.advanceTimersByTimeAsync(5_000);

            await expect(outcome).resolves.toMatchObject({ id: INGREDIENT.id });
            expect(fetchDouble).toHaveBeenCalledTimes(2);
        });
    });

    it('never retries a considered rejection, on any method', async () => {
        const fetchDouble = fetchAnswering(answer(400, { code: 'VALIDATION_ERROR' }), answer(201, INGREDIENT));

        const failure = await client()
            .createFreeformIngredient('salt')
            .catch((error: unknown) => error);

        expect(isRecipeApiError(failure) && failure.code).toBe('VALIDATION_ERROR');
        expect(fetchDouble).toHaveBeenCalledTimes(1);
    });
});
