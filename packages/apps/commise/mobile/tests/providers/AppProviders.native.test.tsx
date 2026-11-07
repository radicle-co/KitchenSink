/**
 * Component test for the mobile `AppProviders` Facade (DA10-a) — proves the composed provider tree
 * actually wires Clerk + a `QueryClientProvider` + the recipe-service client in the ENFORCED order
 * (`RecipeServiceGate` needs `useAuth` AND a mounted query client above it), the same invariant the web
 * `RecipeProviders` test pins. A probe child reads `useAuth`, `useQueryClient`, and
 * `useRecipeServiceClient` — each throws/returns `undefined` outside its own provider, so a successful,
 * non-throwing render with real values back is the observable proof the tree is wired correctly, not an
 * implementation-detail assertion about which JSX nests where.
 *
 * Native-module-heavy collaborators that this test does not exercise (device-locale detection, secure-store
 * token persistence, the safe-area native module) are mocked to a pass-through/no-op — mirroring
 * `AppRoot.native.test.tsx`'s stubbing of `react-native-safe-area-context` and the app's Clerk-backed hooks.
 * This keeps the test focused on the FACADE's composition, not re-proving those collaborators' own behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// AppProviders mounts the design-system provider itself, so it is rendered without one (`renderUnscoped`).
import { cleanup, screen, waitFor, render as renderUnscoped } from '@testing-library/react';
import { useAuth } from '@clerk/expo';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_QUERY_RETRIES } from '@commise/query';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { Text } from 'react-native';

// `useClerk` is the identity client the gate mints from and its token proxy reads (ADR-0054): one object for the app's
// life, as Clerk's is, and nobody is signed in here.
const { clerk } = vi.hoisted(() => ({ clerk: { session: null } }));

// The error reporter reaches the Sentry SDK, which needs the native runtime; the gate only hands it to the queue.
vi.mock('../../src/observability/sentryErrorReporter.js', () => ({ reportErrorToSentry: vi.fn() }));

vi.mock('@clerk/expo', () => ({
    ClerkProvider: ({ children }: { readonly children?: unknown }) => children,
    useAuth: vi.fn(),
    useClerk: () => clerk,
}));

vi.mock('../../src/i18n/LocaleProvider.js', () => ({
    LocaleProvider: ({ children }: { readonly children?: unknown }) => children,
}));

vi.mock('../../src/storage/tokenCache.js', () => ({ tokenCache: {} }));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

const useAuthMock = vi.mocked(useAuth);

// ⛔ The code under test is loaded HERE, once, at module scope, and never inside a test. Loading it transforms and
// evaluates the whole provider graph (Clerk, TanStack, the recipe client, Tamagui and the design system); inside a test
// that cost counted against the test's timeout, so the first test of the file (3.7 s alone) timed out at 15 s on a
// contended machine. At module scope it is collection work, which no test timeout covers. The publishable key `env.ts`
// reads at load comes from this lane's own `env` (`vitest.native.config.ts`).
const { AppProviders } = await import('../../src/providers/AppProviders.js');
const { NotFoundError, UnexpectedResponseError } = await import('@kitchensink/recipe-service-client');

beforeEach(() => {
    useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok_abc') } as unknown as ReturnType<
        typeof useAuth
    >);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** Reads from every context `AppProviders` is supposed to mount, and renders what it found. */
function ContextProbe() {
    const { getToken } = useAuth();
    const queryClient = useQueryClient();
    const client = useRecipeServiceClient();

    return (
        <Text testID="probe">
            {[
                typeof getToken === 'function' ? 'auth' : 'no-auth',
                queryClient ? 'query' : 'no-query',
                client ? 'recipe' : 'no-recipe',
            ].join(',')}
        </Text>
    );
}

describe('AppProviders (DA10-a facade)', () => {
    it('mounts Clerk, a QueryClientProvider, and the recipe-service client in the enforced order', async () => {
        renderUnscoped(
            <AppProviders>
                <ContextProbe />
            </AppProviders>,
        );

        await waitFor(() => expect(screen.getByText('auth,query,recipe')).toBeTruthy());
    });

    it.each([
        ['a 404 costs exactly ONE request', 'not-found', 1],
        ['a 500 still retries to the cap', 'server-error', MAX_QUERY_RETRIES + 1],
        ['a transport failure still retries to the cap', 'transport', MAX_QUERY_RETRIES + 1],
    ] as const)(
        'mounts a query client carrying the SHARED retry policy — %s',
        async (_label, kind, attempts) => {
            // ⛔ THE MOBILE MIRROR of the web facade's assertion, and it is not redundant: the two roots each
            // built their OWN `new QueryClient()`, so a fix applied to one platform could silently miss the
            // other — which is exactly the drift the cross-platform rule exists to stop. Driven with a real
            // `useQuery` rather than `queryClient.fetchQuery`, because `fetchQuery` forces `retry: false` when
            // the resolved option is `undefined` (query-core, TanStack #652), so the 404 row would have passed
            // against a bare client. The other two rows are what stops the fix from being "retries off".
            //
            // ⚠ The error class and `AppProviders` come from the SAME module load (both at module scope above). A
            // `NotFoundError` from another registry would fail the policy's `instanceof`, be treated as a foreign
            // error and be retried: a red test caused entirely by the harness.
            const error =
                kind === 'not-found'
                    ? new NotFoundError()
                    : kind === 'server-error'
                      ? new UnexpectedResponseError(500)
                      : new TypeError('Failed to fetch');
            const queryFn = vi.fn().mockRejectedValue(error);

            function FailingProbe() {
                const { isError } = useQuery({ queryKey: ['probe', kind], queryFn });

                return <Text>{isError ? 'errored' : 'pending'}</Text>;
            }

            renderUnscoped(
                <AppProviders>
                    <FailingProbe />
                </AppProviders>,
            );

            await screen.findByText('errored', undefined, { timeout: 25_000 });

            expect(queryFn).toHaveBeenCalledTimes(attempts);
        },
        30_000,
    );

    it('throws if a child tries to read the recipe-service client OUTSIDE the tree (order is load-bearing)', () => {
        // `useRecipeServiceClient` (unwrapped) proves the gate is genuinely providing context, not a no-op —
        // characterizes the SAME contract the RecipeServiceProvider ships (see its own "must be used
        // within" guard), so a future re-order that drops the provider would fail this, not just silently
        // render undefined.
        function Unwrapped() {
            useRecipeServiceClient();

            return null;
        }

        expect(() => renderUnscoped(<Unwrapped />)).toThrow(/RecipeServiceProvider/);
    });
});
