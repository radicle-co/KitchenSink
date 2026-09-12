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
 *  - before `getToken` is defined (SSR / pre-hydration), NO request is issued at all — the supplier refuses
 *    with a typed `RecipeAuthNotReadyError` rather than fabricating an empty bearer (see that case's own
 *    comment for the reversal, and for why it awaits the request's promise instead of a wall-clock sleep).
 *
 * A source-level check also asserts the render-mutated-ref pattern itself is gone from the file.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { useEffect, useState, type ReactElement } from 'react';
import { useSyncQueue } from '@commise/query/sync';

import { RecipeAuthNotReadyError } from '@/lib/recipeAuthNotReady';

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

/**
 * Render the provider tree and hand back the client it supplied, so a test can await a request's OWN
 * promise instead of a timer.
 *
 * The button path (`renderProbe`) fires the request and DROPS the promise, which is fine for a positive
 * assertion — `waitFor` polls until the expected call lands — but leaves a negative assertion with
 * nothing to synchronize on. Holding the promise makes "the client has finished" observable.
 */
function renderProbeCapturingClient(): RecipeServiceClient {
    let captured: RecipeServiceClient | undefined;

    render(
        <RecipeProviders>
            <ClientProbe
                onClient={(client) => {
                    captured = client;
                }}
            />
        </RecipeProviders>,
    );

    if (captured === undefined) {
        throw new Error('RecipeProviders did not supply a recipe-service client to the probe');
    }

    return captured;
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
        useAuthMock.mockReturnValue({ getToken: undefined });

        const client = renderProbeCapturingClient();

        // ⛔ NOT a wall-clock sleep. A `setTimeout(50)` "wait" cannot prove a negative: it passes whenever the
        // fetch is merely slower than the sleep, so it asserts "no fetch within 50ms" while claiming "no
        // fetch". The request's real async boundary is the promise `listRecipes()` returns — the token
        // supplier throws inside ky's `beforeRequest` hook, which is a plain microtask chain with no timer
        // (`retry: 0`, and `send()` retries only a 401 RESPONSE, which a refusal never produces). Awaiting
        // that promise to settlement is therefore exact: by the time it resolves the client has done
        // everything it intends to do, so a `fetch` it decided to issue is ALREADY recorded on the mock.
        const outcome = await client.listRecipes().then(
            () => undefined,
            (error: unknown) => error,
        );

        // The request is never sent: no empty `Bearer`, no 401, nothing for the redirect handler to see.
        expect(fetchMock).not.toHaveBeenCalled();
        // …and the refusal is the TYPED one, so "not ready" stays distinguishable from "the server said no".
        expect(outcome).toBeInstanceOf(RecipeAuthNotReadyError);
    });
});

describe('RecipeProviders (web) — no render-mutated ref remains', () => {
    it('does not mutate a ref during render to bridge getToken into the client (source-level check)', () => {
        const filePath = resolve(process.cwd(), 'src/components/recipes/RecipeProviders.tsx');
        const source = readFileSync(filePath, 'utf-8');

        expect(source).not.toContain('getTokenRef');
        // ⛔ A CALL, NOT THE BARE WORD. This read `/\buseRef\b/` over RAW source, so it matched PROSE: the
        // ⚠️ comment in `RecipeProviders.tsx` explaining why there is no ref — the record of this very rule —
        // turned the guard red. A guard that forbids documenting the rule it enforces is the wrong
        // instrument, and the house comment-stripper (`roleSplitSources.ts`) lives in `packages/infra/global`
        // where this package cannot import it. Narrowing to the CALL is exact rather than a weakening: the
        // defect named in this test's title is a ref MUTATED DURING RENDER, which cannot exist without
        // `useRef(` — an unused import creates no `.current` to write. The semantic check is `react-hooks/refs`,
        // which refused the ref-based draft on its own; this is the cheap source-level backstop for it.
        // ⚠️ `[<(]`, NOT `\(` — `useRef<T>(…)` is the DOMINANT spelling in this repo (`IngredientPicker`,
        // `useRecipeEditor`, `MoreActionsMenu` …), and a `\(`-only guard misses every one of them. The
        // first mutation run here injected the UNTYPED `useRef(client)`, i.e. the one form that regex did
        // catch — a red run that proved less than it appeared to. Mutate the least-covered spelling.
        expect(source).not.toMatch(/\buseRef\s*[<(]/);
        expect(source).toContain('useMemo');
    });
});

describe('RecipeProviders (web) — the sync queue mount', () => {
    // ⛔ THESE EXIST BECAUSE THE SUITE WAS BLIND HERE. Changing the queue from a shared
    // `subject={userId ?? 'anonymous'}` to a real-`userId` gate left all five tests above GREEN in BOTH
    // states — they mock `useAuth` without a `userId`, so they never observed whether a queue was mounted at
    // all. A change that passes identically before and after is not covered; it is unobserved.
    //
    // The contract mirrors mobile's `RecipeServiceGate` exactly, which is the point: a queue namespaced by a
    // placeholder is one shared outbox for every signed-out visitor, and the two platforms must not disagree
    // about a rule only one of them writes down.
    /** Reports whether a queue is above it, by what `submit` actually DOES — `pendingCount` reads 0 either way. */
    function QueueProbe(): ReactElement {
        const queue = useSyncQueue();
        const [outcome, setOutcome] = useState('pending');

        useEffect(() => {
            queue
                .submit({
                    entity: 'recipe',
                    intentKind: 'update',
                    localId: 'r1',
                    dependsOn: [],
                    payload: {},
                })
                .then(
                    () => setOutcome('queued'),
                    () => setOutcome('refused'),
                );
        }, [queue]);

        return <span>{outcome}</span>;
    }

    it('mounts a queue that ACCEPTS a write for a signed-in viewer', async () => {
        useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok'), userId: 'user_abc' });

        render(
            <RecipeProviders>
                <QueueProbe />
            </RecipeProviders>,
        );

        await waitFor(() => expect(screen.getByText('queued')).toBeTruthy());
    });

    /**
     * ⛔ THE OFFLINE NOTICE SURVIVES THE GATE, and this test exists because that regression already happened
     * once. Gating the queue on `userId` dragged `SyncNoticeHost` inside the signed-in branch on the
     * reasoning that "a signed-out visitor has nothing to sync". `syncNoticeState.ts` disproves it: a branch
     * exists ONLY for offline-with-zero-pending (`offlineBodyNone`), because the owner's bar is BOTH halves
     * — tell the cook they are offline AND what has not synced. The first half needs no queue, and public
     * recipe pages are readable signed out, so the notice became dead copy for every anonymous visitor.
     *
     * ⛔ AND THE HOST IS MOUNTED TWICE ON PURPOSE. Hoisting it above the conditional would look like the
     * obvious de-duplication and would be wrong: outside a provider `useSyncQueue()` returns the
     * NOT_MOUNTED default, whose `pendingCount` is 0 for EVERYONE, silently killing the `syncing` body for
     * signed-in cooks. Anyone "tidying" the duplication must make this test fail first.
     */
    it('⛔ still shows the offline notice to a SIGNED-OUT viewer, which needs no queue', async () => {
        useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok'), userId: null });
        act(() => {
            onlineManager.setOnline(false);
        });

        try {
            render(
                <RecipeProviders>
                    <span>child</span>
                </RecipeProviders>,
            );

            await waitFor(() => expect(screen.getByText(/offline/iu)).toBeTruthy());
        } finally {
            act(() => {
                onlineManager.setOnline(true);
            });
        }
    });

    /**
     * ⛔ THE SUBTREE MUST SURVIVE `userId` RESOLVING. This is a REGRESSION TEST for a defect I shipped: gating
     * the queue with `{userId ? <SyncProvider>… : <>…</>}` changes the ELEMENT TYPE at that tree position, so
     * when Clerk resolves `userId` React unmounts and remounts everything below — including
     * `RecipeServiceProvider` and every feature's state.
     *
     * ⚠️ IT WAS DISMISSED AS UNREACHABLE AND WAS NOT. The reasoning was that `@clerk/nextjs` resolves `userId`
     * from the SSR `initialState`, so the transition never happens on web. CI disproved it: six Playwright
     * shards that passed on the previous commit failed on mine, across `recipeEditWizard`,
     * `addIngredientLoop`, `authoredFoodCreate`, `ingredientCatalogPick`, `ingredientCorrection` and
     * `recipePhotos` — every one a flow that holds editor state across a click. A draft typed before the
     * transition was gone after it.
     *
     * The cure is that `SyncProvider` is mounted UNCONDITIONALLY and owns the absent-subject case itself, so
     * there is no conditional here to change shape. This test fails for any fix that reintroduces one.
     */
    it('⛔ does NOT remount the subtree when userId resolves from absent to present', async () => {
        useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok'), userId: null });

        let mountCount = 0;

        function MountCounter(): ReactElement {
            useEffect(() => {
                mountCount += 1;
            }, []);

            return <span>counted</span>;
        }

        const { rerender } = render(
            <RecipeProviders>
                <MountCounter />
            </RecipeProviders>,
        );

        await waitFor(() => expect(screen.getByText('counted')).toBeTruthy());
        expect(mountCount).toBe(1);

        // Clerk hands back a real user; the tree below must be PRESERVED, not rebuilt.
        useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok'), userId: 'user_abc' });
        rerender(
            <RecipeProviders>
                <MountCounter />
            </RecipeProviders>,
        );

        await waitFor(() => expect(screen.getByText('counted')).toBeTruthy());
        // A remount runs the mount effect a second time — which is the editor state being wiped.
        expect(mountCount).toBe(1);
    });

    it('refuses the write for a signed-out viewer rather than sharing one outbox', async () => {
        useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok'), userId: null });

        render(
            <RecipeProviders>
                <QueueProbe />
            </RecipeProviders>,
        );

        // ⛔ REFUSED BY THE PROVIDER, not by an absent one. The queue IS mounted for a signed-out viewer —
        // gating the mount is what remounted the subtree — and it refuses rather than queueing anonymously.
        // A dropped write is the failure this whole layer exists to prevent.
        await waitFor(() => expect(screen.getByText('refused')).toBeTruthy());
    });
});
