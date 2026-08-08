// @vitest-environment jsdom
/**
 * Component/characterization tests for `RecipeProviders` (B14 — CP-9 Task 11).
 *
 * `RecipeProviders` used to bridge Clerk's `useAuth().getToken` into the once-constructed
 * `RecipeServiceClient`'s `TokenSource` via a ref MUTATED DURING RENDER (`getTokenRef.current = getToken`)
 * — the render-mutated-ref smell `docs/engineering/ENGINEERING_EXCELLENCE.md` / CLAUDE.md §3 forbids. The
 * fix `useMemo`s the client with `getToken` as its dependency, so the `TokenSource` closure captures
 * `getToken` directly (no ref) and the client is only rebuilt on the rare render where Clerk hands back a
 * genuinely new `getToken` identity.
 *
 * These tests pin the OBSERVABLE behavior the ref used to guarantee, so a regression to a stale closure (or
 * to a client that never resolves a fresh token) fails loudly:
 *  - a request resolves the CURRENT `getToken` (not a token captured only at construction time);
 *  - after Clerk hands back a NEW `getToken` (a re-render with a different function identity — the only way
 *    the ref's bridge was ever observably different from a plain closure), the very next request uses it;
 *  - `forceRefresh` (B22) still threads through to Clerk's `skipCache`, so the identity-sync / expired-token
 *    retry paths in `RecipeServiceClient` are not broken by the rework;
 *  - before `getToken` is defined (SSR / pre-hydration), a request is sent unauthenticated rather than
 *    throwing.
 *
 * A source-level check also asserts the render-mutated-ref pattern itself is gone from the file.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import type { ReactElement } from 'react';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));

const { RecipeProviders } = await import('../RecipeProviders.js');

/** Grabs the recipe-service client from context so a test can drive an authenticated request through it. */
function ClientProbe({ onClient }: { readonly onClient: (client: RecipeServiceClient) => void }): ReactElement {
    const client = useRecipeServiceClient();
    onClient(client);

    return <button onClick={() => void client.listRecipes().catch(() => undefined)}>fetch</button>;
}

function renderProbe(): { fetchButton: () => HTMLElement } {
    render(
        <RecipeProviders>
            <ClientProbe onClient={() => undefined} />
        </RecipeProviders>,
    );

    return { fetchButton: () => screen.getByRole('button', { name: 'fetch' }) };
}

/** The `Authorization` header the fake `fetch`'s Nth call received, or `null` if absent. */
function authorizationAt(fetchMock: ReturnType<typeof vi.fn>, index = 0): string | null {
    const request = fetchMock.mock.calls[index]?.[0] as Request;

    return request.headers.get('authorization');
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    // A plain 500 (never 401) so the client's own automatic 401 retries don't add extra fetch calls this
    // suite isn't asserting on — those retry paths are exercised explicitly below.
    fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('RecipeProviders (web) — token resolution', () => {
    it('resolves the current getToken for a request', async () => {
        const user = userEvent.setup();
        const getToken = vi.fn().mockResolvedValue('tok-A');
        useAuthMock.mockReturnValue({ getToken });

        const { fetchButton } = renderProbe();
        await user.click(fetchButton());

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(authorizationAt(fetchMock)).toBe('Bearer tok-A');
    });

    it('uses a NEW getToken after Clerk hands back a different one, without a stale closure', async () => {
        const user = userEvent.setup();
        const getTokenA = vi.fn().mockResolvedValue('tok-A');
        useAuthMock.mockReturnValue({ getToken: getTokenA });

        const { rerender, unmount } = render(
            <RecipeProviders>
                <ClientProbe onClient={() => undefined} />
            </RecipeProviders>,
        );
        await user.click(screen.getByRole('button', { name: 'fetch' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(authorizationAt(fetchMock, 0)).toBe('Bearer tok-A');

        // Simulate Clerk handing back a genuinely new `getToken` identity (its own `useCallback` is keyed on
        // the underlying Clerk instance, so this happens on a real identity swap — e.g. hydration handoff or
        // sign-in/out) by re-rendering with a DIFFERENT function.
        const getTokenB = vi.fn().mockResolvedValue('tok-B');
        useAuthMock.mockReturnValue({ getToken: getTokenB });
        rerender(
            <RecipeProviders>
                <ClientProbe onClient={() => undefined} />
            </RecipeProviders>,
        );

        await user.click(screen.getByRole('button', { name: 'fetch' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(authorizationAt(fetchMock, 1)).toBe('Bearer tok-B');
        expect(getTokenB).toHaveBeenCalled();

        unmount();
    });

    it('threads an ordinary expired-token retry through to a force-refreshed (skipCache) token — B22', async () => {
        const user = userEvent.setup();
        const getToken = vi.fn().mockResolvedValueOnce('tok-stale').mockResolvedValueOnce('tok-fresh');
        useAuthMock.mockReturnValue({ getToken });

        // First attempt 401s (ordinary expired token, no IDENTITY_SYNC_PENDING code) — the client retries
        // exactly once with `forceRefresh: true`; the second attempt succeeds.
        fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 401 }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }), { status: 200 }),
            );
        vi.stubGlobal('fetch', fetchMock);

        const { fetchButton } = renderProbe();
        await user.click(fetchButton());

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(authorizationAt(fetchMock, 0)).toBe('Bearer tok-stale');
        expect(authorizationAt(fetchMock, 1)).toBe('Bearer tok-fresh');
        expect(getToken).toHaveBeenNthCalledWith(1, { skipCache: false });
        expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
    });

    // ⚠️ REVERSES a decision this suite previously asserted as correct. The old test was
    // "sends an unauthenticated request (never throws) before getToken is defined — SSR/pre-hydration",
    // and it pinned `authorizationAt(fetchMock)` to `'Bearer'` — an EMPTY bearer.
    //
    // That is a fabricated credential, and it cannot succeed: every protected recipe endpoint answers
    // `401 {"message":"Missing bearer token"}`. Observed in production on 2026-08-07 —
    // `GET recipe.commise.app/api/v1/recipes?pageSize=4` returned 401 on a signed-in Home load, while the
    // identical call with a real token returned 200. The 401 then met the app's redirect-to-sign-in
    // handler. "Never throws" bought nothing: issuing a request that CANNOT succeed is not more graceful
    // than declining to issue it, and it converts a transient not-ready state into a server-side auth
    // failure indistinguishable from a genuine one.
    //
    // Now the supplier throws a typed `RecipeAuthNotReadyError`. TanStack Query's default retry recovers
    // it once hydration completes, so the transient case self-heals WITHOUT a doomed round trip — and no
    // 401 is ever produced, so nothing can trigger the sign-in bounce.
    it('does NOT issue an unauthenticated request before getToken is defined — SSR/pre-hydration', async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ getToken: undefined });

        const { fetchButton } = renderProbe();
        await user.click(fetchButton());

        // The request is never sent: no empty `Bearer`, no 401, nothing for the redirect handler to see.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('RecipeProviders (web) — no render-mutated ref remains', () => {
    it('does not mutate a ref during render to bridge getToken into the client (source-level check)', () => {
        const filePath = resolve(process.cwd(), 'src/components/recipes/RecipeProviders.tsx');
        const source = readFileSync(filePath, 'utf-8');

        expect(source).not.toContain('getTokenRef');
        expect(source).not.toMatch(/\buseRef\b/);
        expect(source).toContain('useMemo');
    });
});
