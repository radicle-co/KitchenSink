// @vitest-environment jsdom
/**
 * Component test for the web `RecipeProviders` Facade (DA10-a) — proves the composed provider tree
 * actually wires a `QueryClientProvider` + the recipe-service client (`RecipeServiceProvider`) above
 * `children`, the invariant the mobile `AppProviders` test pins on the native side. `@clerk/nextjs` is
 * mocked (no real Clerk session needed); a probe child reads `useQueryClient` and `useRecipeServiceClient`
 * — both throw/return `undefined` outside their own provider — so a successful render proves the tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_QUERY_RETRIES } from '@commise/query';
import { NotFoundError, UnexpectedResponseError } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));

import { RecipeProviders } from '@/components/recipes/RecipeProviders';

beforeEach(() => {
    useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok_abc') });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** Reads from every context `RecipeProviders` is supposed to mount, and renders what it found. */
function ContextProbe() {
    const queryClient = useQueryClient();
    const client = useRecipeServiceClient();

    return <span>{[queryClient ? 'query' : 'no-query', client ? 'recipe' : 'no-recipe'].join(',')}</span>;
}

describe('RecipeProviders (DA10-a facade)', () => {
    it('mounts a QueryClientProvider and the recipe-service client above children', () => {
        render(
            <RecipeProviders>
                <ContextProbe />
            </RecipeProviders>,
        );

        expect(screen.getByText('query,recipe')).toBeInTheDocument();
    });

    it.each([
        ['a 404 costs exactly ONE request', new NotFoundError(), 1],
        ['a 500 still retries to the cap', new UnexpectedResponseError(500), MAX_QUERY_RETRIES + 1],
        ['a transport failure still retries to the cap', new TypeError('Failed to fetch'), MAX_QUERY_RETRIES + 1],
    ])(
        'mounts a query client carrying the SHARED retry policy — %s',
        async (_label, error, attempts) => {
            // ⛔ ASSERTED AS ATTEMPTS ISSUED through the client this tree actually mounts, and driven with a
            // real `useQuery` rather than `queryClient.fetchQuery`. That is not a style choice: `fetchQuery`
            // forces `retry: false` when the resolved option is `undefined` (query-core, TanStack #652), so a
            // BARE `new QueryClient()` also answers "one attempt" through it — the 404 row would have passed
            // against the very client this change replaces.
            //
            // The defect was measured in requests and seconds: a bare client applied TanStack's default
            // `retry: 3` to a 404, so a cook following a dead recipe link waited ~7s on backoff while the API
            // absorbed four requests to say "no". The other two rows are what stops the fix from being
            // "retries off" — they fail against any policy that refuses everything.
            const queryFn = vi.fn().mockRejectedValue(error);

            function FailingProbe() {
                const { isError } = useQuery({ queryKey: ['probe', String(error)], queryFn });

                return <span>{isError ? 'errored' : 'pending'}</span>;
            }

            render(
                <RecipeProviders>
                    <FailingProbe />
                </RecipeProviders>,
            );

            await screen.findByText('errored', undefined, { timeout: 25_000 });

            expect(queryFn).toHaveBeenCalledTimes(attempts);
        },
        30_000,
    );

    it('throws if a child tries to read the recipe-service client OUTSIDE the tree (order is load-bearing)', () => {
        function Unwrapped() {
            useRecipeServiceClient();

            return null;
        }

        expect(() => render(<Unwrapped />)).toThrow(/RecipeServiceProvider/);
    });
});
