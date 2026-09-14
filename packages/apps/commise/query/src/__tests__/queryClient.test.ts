/**
 * Behaviour tests for `createAppQueryClient`.
 *
 * These drive a REAL `QueryClient` and count how many times the query function is actually called, rather
 * than reading `getDefaultOptions()` back. Asserting the option is set proves the object was configured;
 * asserting the CALL COUNT proves TanStack honoured it — and the call count is the unit the defect is
 * measured in (four requests and ~7s of backoff for one miss).
 *
 * ⛔ DRIVEN THROUGH A `QueryObserver`, NOT `queryClient.fetchQuery`, and that is not a style choice.
 * `fetchQuery` forces `retry: false` whenever the resolved option is `undefined` (query-core, for
 * TanStack issue #652), so a bare `new QueryClient()` also answers "one attempt" through it — the
 * 404 assertion below would have passed against the very client this module replaces, which is
 * coverage theatre. An observer resolves `retry` from `defaultOptions` exactly as a mounted `useQuery`
 * does, so these counts fail if the policy is removed.
 */
import { QueryObserver, type QueryClient } from '@tanstack/react-query';
import { NotFoundError, UnexpectedResponseError } from '@kitchensink/recipe-service-client';
import { describe, expect, it, vi } from 'vitest';

import { MAX_QUERY_RETRIES } from '../retryPolicy.js';
import { createAppQueryClient } from '../queryClient.js';

/** A distinct key per probe, so no observer ever reads another's cached failure. */
let probe = 0;

/**
 * Drive one query to its terminal error through a real client and report how many attempts were issued.
 *
 * @param client - The client whose defaults are under test.
 * @param error - The value the query function rejects with, every time.
 * @returns The number of attempts TanStack made.
 */
async function attemptsFor(client: QueryClient, error: unknown): Promise<number> {
    const queryFn = vi.fn().mockRejectedValue(error);
    probe += 1;
    const observer = new QueryObserver(client, { queryKey: ['probe', probe], queryFn });

    await new Promise<void>((resolve) => {
        const unsubscribe = observer.subscribe((result) => {
            if (result.isError) {
                unsubscribe();
                resolve();
            }
        });
    });

    client.clear();

    return queryFn.mock.calls.length;
}

describe('createAppQueryClient — attempts actually issued', () => {
    it('issues exactly ONE request for a 404', async () => {
        // ⛔ THE DEFECT, in the unit the cook pays it in. Before the policy this was four requests and ~7s of
        // exponential backoff before the not-found copy appeared.
        await expect(attemptsFor(createAppQueryClient(), new NotFoundError())).resolves.toBe(1);
    });

    it('still retries a 500 up to the cap — the fix is a predicate, not "retries off"', async () => {
        await expect(attemptsFor(createAppQueryClient(), new UnexpectedResponseError(500))).resolves.toBe(
            MAX_QUERY_RETRIES + 1,
        );
    });

    it('still retries a transport failure up to the cap', async () => {
        await expect(attemptsFor(createAppQueryClient(), new TypeError('Failed to fetch'))).resolves.toBe(
            MAX_QUERY_RETRIES + 1,
        );
    });
}, 60_000);

describe('createAppQueryClient — mutations', () => {
    it('leaves mutation retries OFF, because a replayed write is not a free retry', async () => {
        // ⛔ DELIBERATE, and stated so nobody "completes" the config later. TanStack defaults mutations to no
        // retry; replaying a non-idempotent POST without an idempotency key is a different and worse failure
        // than the one this policy fixes. `hooks.ts`'s own note on the live-ingredient-search mutation makes
        // the concrete case: a retry there would double the quota cost of exactly the refusal
        // (`SourceBusyError`) that means the quota is spent.
        const client = createAppQueryClient();
        const mutationFn = vi.fn().mockRejectedValue(new UnexpectedResponseError(500));

        await client
            .getMutationCache()
            .build(client, { mutationFn })
            .execute(undefined)
            .catch(() => undefined);

        expect(mutationFn).toHaveBeenCalledTimes(1);
    });
});
