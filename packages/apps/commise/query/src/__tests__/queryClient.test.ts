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
import { QueryObserver, onlineManager, type QueryClient } from '@tanstack/react-query';
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

describe('createAppQueryClient — offline reads', () => {
    /**
     * ⛔ THIS TEST ASSERTS WHAT ACTUALLY HAPPENS, INCLUDING THE HALF THAT IS STILL BROKEN, and the first
     * draft of it did not. That draft passed `retry: false` to the observer — which deletes the only branch
     * in which the network modes differ, so it asserted an outcome the SHIPPED configuration never produces.
     * That is the coverage theatre this file's own header forbids, arriving one layer down: the header warns
     * against reading `getDefaultOptions()` back, and an option override is the same mistake wearing a
     * behavioural costume.
     *
     * Measured against the pinned `query-core`, offline, driving a real observer:
     *
     *     mode + retry                  | calls | status  | fetchStatus
     *     'online'      + shouldRetry   |     0 | pending | paused      ← before
     *     'offlineFirst'+ shouldRetry   |     1 | pending | paused      ← SHIPPED
     *     'offlineFirst'+ retry:false   |     1 | error   | idle        ← only the bad test
     *     'always'      + shouldRetry   |     4 | error   | idle
     *
     * So `offlineFirst` buys exactly ONE thing: the first attempt fires. That closes the case this defect is
     * most often reached through — mobile's NetInfo reporting UNKNOWN connectivity, where the device is
     * actually online and the attempt now succeeds. It does NOT close a genuine outage: `retryer.js:100` is
     * `canContinue() ? void 0 : pause()` and `canContinue` (`:51`) requires `onlineManager.isOnline()`, so
     * after the first failure the query parks at `paused` and the surface renders its loading state forever.
     *
     * ⚠️ `paused` HAS NO OWNER IN THIS CODEBASE — `QueryBoundary` models pending/failed/settled and `paused`
     * collapses into pending; nothing in `packages/` reads `fetchStatus`. No `networkMode` value can supply
     * that owner, which is why this test pins the broken half rather than pretending it away. It is the
     * failing assertion whoever closes that gap will flip.
     */
    it('fires the first attempt while offline, then parks at `paused` (the half still unowned)', async () => {
        const wasOnline = onlineManager.isOnline();
        onlineManager.setOnline(false);

        try {
            probe += 1;
            const client = createAppQueryClient('browser');
            const queryFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
            const observer = new QueryObserver(client, {
                queryKey: ['offlineProbe', probe],
                queryFn,
            });
            const unsubscribe = observer.subscribe(() => undefined);

            try {
                // The attempt the mode buys: under `'online'` this stays 0 forever.
                await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
                // ...and then it parks. Under `'always'` this would reach `idle` after 4 attempts instead.
                // ⚠️ The wait must outlast the FIRST retry backoff (~1s), not `vi.waitFor`'s 1s default:
                // between the failed attempt and the paused retry the status reads `fetching`, so a default
                // window catches the sleep and reports `fetching`, which looks like the opposite finding.
                await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('paused'), {
                    timeout: 10_000,
                    interval: 50,
                });
                expect(observer.getCurrentResult().isPending).toBe(true);
            } finally {
                unsubscribe();
            }
        } finally {
            onlineManager.setOnline(wasOnline);
        }
    }, 20_000);
});
