/**
 * INTEGRATION tier for the shared query retry policy: how many HTTP requests a cook's browser actually
 * issues for one failed read.
 *
 * ⛔ WHY THIS TIER EXISTS AT ALL, given the unit tests below it. Every one of those constructs the error
 * class by hand and hands it to a predicate. None of them can tell you that a real `404` from a real server
 * still ARRIVES as a `NotFoundError` — the chain is `fetch` → ky → `RecipeServiceClient.send` → its own
 * internal `401` replay logic → `errorForStatus` → the typed class → the policy → TanStack's retryer, and a
 * break anywhere in it leaves the policy correct and the app still issuing four requests. That is exactly
 * the shape of failure the repo's own testing mandate names: "a unit test that mocks the boundary proves
 * your code calls the mock correctly."
 *
 * So this drives a REAL `RecipeServiceClient` over a REAL `QueryClient` built by `createAppQueryClient`,
 * with only `fetch` doubled — and it counts HTTP requests, not predicate calls. The transport, the status →
 * error mapping and the retry decision are all the shipping ones.
 *
 * ⚠️ The counts are asserted at the FETCH, not through `queryClient.fetchQuery`, which forces `retry: false`
 * whenever the resolved option is `undefined` (query-core, TanStack #652) and would therefore report "one
 * request" for a bare client too.
 */
import { QueryObserver } from '@tanstack/react-query';
import { createAppQueryClient, MAX_QUERY_RETRIES } from '@commise/query';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { describe, expect, it, vi } from 'vitest';

import { RecipeAuthNotReadyError } from '@/lib/recipeAuthNotReady';

const BASE = 'https://recipes.example.test';
const RECIPE_ID = '00000000-0000-4000-8000-00000000000a';

/**
 * A `fetch` double answering every call with `status`, in the service's own error envelope.
 *
 * ⚠️ The body carries a `message` and NO `code`, deliberately. `RecipeServiceClient` disambiguates by the
 * body's published `code` BEFORE falling back to the status, so a fixture that pasted the same
 * `code: 'NOT_FOUND'` onto every status would have every response arrive as a `NotFoundError` — the `500`
 * and `429` rows below would then "prove" no retry and look like a policy bug. A code-less body is what
 * actually exercises the status mapping these rows are about.
 */
function stubStatus(status: number): { readonly fetch: typeof fetch; readonly urls: () => readonly string[] } {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: Request | string | URL) => {
        // The skew probe calls the RAW fetch and may pass a string or `URL` rather than a `Request`, so read
        // the target defensively — a `request.url` read alone throws `undefined` into the filter below.
        urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

        return new Response(JSON.stringify({ message: 'nope' }), {
            status,
            headers: { 'content-type': 'application/json' },
        });
    });

    return { fetch: fetchMock as unknown as typeof fetch, urls: () => urls.filter(isTheRecipeRead) };
}

/**
 * Whether a recorded request is the recipe READ, as opposed to the contract-skew probe.
 *
 * ⚠️ NOT decoration. `RecipeServiceClient.send` fires `reportContractSkewOnce` after every response —
 * un-awaited, once per ORIGIN per PROCESS. So exactly one suite in this file, whichever runs first, records
 * an extra request to a different path, and a raw call count would make that suite (and only that suite)
 * report one attempt too many. Filtering by path makes the counts independent of test order instead of
 * making the first row absorb a constant nobody can see.
 */
function isTheRecipeRead(url: string): boolean {
    return url.includes('/api/v1/recipes/');
}

/**
 * Read one recipe through the real client + the real app query client, and report the HTTP requests issued.
 *
 * @param transport - The `fetch` double the client sends through.
 * @returns The number of requests that reached the transport before the query gave up.
 */
async function requestsIssued(transport: typeof fetch): Promise<void> {
    const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: transport });
    const queryClient = createAppQueryClient();
    const observer = new QueryObserver(queryClient, {
        queryKey: ['recipe', RECIPE_ID],
        queryFn: () => client.getRecipeById(RECIPE_ID),
    });

    await new Promise<void>((resolve) => {
        const unsubscribe = observer.subscribe((result) => {
            if (result.isError) {
                unsubscribe();
                resolve();
            }
        });
    });

    queryClient.clear();
}

describe('query retry policy — requests a real browser would issue', () => {
    it('spends exactly ONE request on a 404, through the real transport and error mapping', async () => {
        // ⛔ THE DEFECT, end to end. A dead or deleted recipe link used to cost the cook ~7s of exponential
        // backoff and the API four requests to say "no".
        const transport = stubStatus(404);

        await requestsIssued(transport.fetch);

        expect(transport.urls()).toHaveLength(1);
    });

    it.each([400, 403, 409, 410])('spends exactly ONE request on a %i', async (status) => {
        const transport = stubStatus(status);

        await requestsIssued(transport.fetch);

        expect(transport.urls()).toHaveLength(1);
    });

    it('STILL retries a 500 to the cap — a server fault is transient and must keep its retries', async () => {
        // ⛔ The assertion that makes the 404 rows meaningful. A policy that simply switched retries off
        // would pass every row above and be the wrong fix.
        const transport = stubStatus(500);

        await requestsIssued(transport.fetch);

        expect(transport.urls()).toHaveLength(MAX_QUERY_RETRIES + 1);
    });

    it('STILL retries a transport failure to the cap — nothing answered, so nothing is terminal', async () => {
        const transport = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        }) as unknown as typeof fetch;

        await requestsIssued(transport);

        expect(vi.mocked(transport)).toHaveBeenCalledTimes(MAX_QUERY_RETRIES + 1);
    });

    it('STILL retries a 429, the one 4xx a status RANGE would have wrongly refused', async () => {
        // The service answers `429 TOO_MANY_REQUESTS` as an `UnexpectedResponseError`, which carries only a
        // status — so this row is the one a "4xx is permanent" shortcut gets backwards, and it is asserted
        // through the real mapping rather than by constructing the class.
        const transport = stubStatus(429);

        await requestsIssued(transport.fetch);

        expect(transport.urls()).toHaveLength(MAX_QUERY_RETRIES + 1);
    });
}, 60_000);

describe('query retry policy — the recovery the abstention default exists to protect', () => {
    it('KEEPS retrying the real `RecipeAuthNotReadyError`, through the real client and the real policy', async () => {
        // ⛔ THE HIGHEST-CONSEQUENCE BEHAVIOUR IN THE WHOLE POLICY, and it is protected by an ABSENCE rather
        // than by a rule: `RecipeAuthNotReadyError` belongs to neither client's hierarchy, so both owner
        // predicates abstain and the composition's `every` lets it through. Nothing special-cases it, which
        // means a future "unknown → do not retry" would silently break it — and what breaks is the recovery
        // `web/src/lib/recipeAuthNotReady.ts` was written for after a measured 2026-08-07 production failure,
        // where a transient pre-hydration state reached the redirect-to-sign-in handler as an auth error.
        //
        // ⚠️ Asserted against the REAL exported class, not a local `class X extends Error {}` stand-in. The
        // unit tier uses a stand-in, which proves the shape of the default and not that THIS class still
        // falls through it — and the class is in a different package from both predicates, so nothing about
        // its identity is guaranteed by construction.
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: () => {
                throw new RecipeAuthNotReadyError();
            },
        });
        const queryClient = createAppQueryClient();
        const queryFn = vi.fn(() => client.getRecipeById(RECIPE_ID));
        const observer = new QueryObserver(queryClient, { queryKey: ['auth-not-ready'], queryFn });

        await new Promise<void>((resolve) => {
            const unsubscribe = observer.subscribe((result) => {
                if (result.isError) {
                    unsubscribe();
                    resolve();
                }
            });
        });

        queryClient.clear();

        expect(queryFn).toHaveBeenCalledTimes(MAX_QUERY_RETRIES + 1);
    });
}, 60_000);
