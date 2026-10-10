// @vitest-environment jsdom
/**
 * Component/characterization tests for `RecipeProviders` (B14 — CP-9 Task 11).
 *
 * `RecipeProviders` used to bridge Clerk's `useAuth().getToken` into the once-constructed
 * `RecipeServiceClient`'s `TokenSource` via a ref MUTATED DURING RENDER (`getTokenRef.current = getToken`)
 * — the render-mutated-ref smell `docs/engineering/ENGINEERING_EXCELLENCE.md` / CLAUDE.md §3 forbids. The
 * fix `useMemo`s the clients, so the `TokenSource` closure captures `getToken` directly (no ref). The memo is
 * keyed on the cook as well (ADR-0054), which the "a client belongs to the cook it was built for" block pins.
 *
 * These tests pin the OBSERVABLE behavior the ref used to guarantee, so a regression to a stale closure (or
 * to a client that never resolves a fresh token) fails loudly:
 *  - a request resolves the CURRENT `getToken` (not a token captured only at construction time);
 *  - after a re-render hands back a NEW `getToken` (a different function identity — the only way the ref's
 *    bridge was ever observably different from a plain closure), the very next request uses it;
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
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { useFoodServiceClient, useFoodServiceSubject } from '@kitchensink/food-service-client/hooks';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { useEffect, useState, type ReactElement } from 'react';
import { useSyncQueue } from '@commise/query/sync';

import { isSessionSubjectChangedError } from '@commise/features-account';
import { appendIntent, loadOutbox, outboxMutatorFor } from '@kitchensink/sync';

import { RecipeAuthNotReadyError } from '@/lib/recipeAuthNotReady';
import { webDeviceStore } from '@/components/recipes/deviceSession';
import { editorDraftsFor } from '@/components/recipes/editorDrafts';

const { useAuthMock, clerk } = vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    // ONE object for the whole file, as `useClerk()` hands back one `IsomorphicClerk` for the app's life. Its `session`
    // is the LIVE session the token proxy reads, so a case moves it to change who is signed in.
    clerk: { session: null as { readonly user: { readonly id: string } } | null | undefined },
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock, useClerk: () => clerk }));

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

/**
 * How many requests reached a service API, leaving out the once-per-origin `/health` contract-skew probe a client fires
 * after its first response.
 */
function apiRequests(): number {
    return fetchMock.mock.calls.filter(([input]) => {
        const url = input instanceof Request ? input.url : String(input);

        return !url.endsWith('/health');
    }).length;
}

/** The `Authorization` header the fake `fetch`'s Nth call received, or `null` if absent. */
function authorizationAt(fetchMock: ReturnType<typeof vi.fn>, index = 0): string | null {
    const request = fetchMock.mock.calls[index]?.[0] as Request;

    return request.headers.get('authorization');
}

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Sign `userId` in, as Clerk would: `useAuth` names them and the live session is theirs. `getToken` stays whatever the
 * case passes, because Clerk's `getToken` keeps one identity for the app's life whoever is signed in.
 *
 * @param userId - The cook, or `null` for nobody.
 * @param getToken - The `getToken` `useAuth` hands back.
 */
function signIn(userId: string | null, getToken: unknown): void {
    useAuthMock.mockReturnValue({ getToken, userId });
    clerk.session = userId === null ? null : { user: { id: userId } };
}

beforeEach(() => {
    clerk.session = null;
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

/** Grabs the food-service client from context (plan 002 S5). */
function FoodClientProbe({ onClient }: { readonly onClient: (client: FoodServiceClient) => void }): ReactElement {
    const client = useFoodServiceClient();

    onClient(client);

    return <button onClick={() => void client.getById('food_1').catch(() => undefined)}>fetch food</button>;
}

/**
 * Plan 002 S5: the app reads foods and their variants from food-service directly, at its own origin and with the
 * same Clerk session token the recipe client sends.
 */
describe('RecipeProviders (web) — the food client', () => {
    it('provides a food client that calls the food origin with the session token', async () => {
        signIn(
            'user_1',
            vi.fn(async () => 'tok_food'),
        );
        let captured: FoodServiceClient | undefined;

        render(
            <RecipeProviders>
                <FoodClientProbe
                    onClient={(client) => {
                        captured = client;
                    }}
                />
            </RecipeProviders>,
        );
        await userEvent.click(screen.getByRole('button', { name: 'fetch food' }));

        expect(captured).toBeInstanceOf(FoodServiceClient);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const request = fetchMock.mock.calls[0]?.[0] as Request | string;
        const url = typeof request === 'string' ? request : request.url;
        const headers =
            typeof request === 'string'
                ? new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers)
                : request.headers;

        expect(url).toBe('http://localhost:3002/api/v1/foods/food_1');
        expect(headers.get('authorization')).toBe('Bearer tok_food');
    });

    // The food client replays a refused request once with a fresh token; skipping Clerk's cache is what makes it fresh.
    it('mints the food client’s replay after a 401 past the token cache (skipCache)', async () => {
        const getToken = vi.fn().mockResolvedValueOnce('tok-stale').mockResolvedValueOnce('tok-fresh');
        signIn('user_1', getToken);
        fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'expired' }), { status: 401 }),
            )
            .mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));
        vi.stubGlobal('fetch', fetchMock);
        let captured: FoodServiceClient | undefined;

        render(
            <RecipeProviders>
                <FoodClientProbe
                    onClient={(client) => {
                        captured = client;
                    }}
                />
            </RecipeProviders>,
        );
        await captured?.getById('food_1').catch(() => undefined);

        expect(getToken).toHaveBeenNthCalledWith(1, { skipCache: false });
        expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
    });

    /** Shows the cook the food hooks act for. */
    function SubjectProbe(): ReactElement {
        return <span>{`subject:${useFoodServiceSubject() ?? 'none'}`}</span>;
    }

    // Plan 002 S3 property 7: the cook's own food reads are keyed on them and purged when their session ends.
    it('hands the signed-in cook to the food hooks', () => {
        signIn(
            'user_1',
            vi.fn(async () => 'tok'),
        );

        render(
            <RecipeProviders>
                <SubjectProbe />
            </RecipeProviders>,
        );

        expect(screen.getByText('subject:user_1')).toBeTruthy();
    });

    it('hands no cook to the food hooks while signed out', () => {
        useAuthMock.mockReturnValue({ getToken: vi.fn(async () => 'tok'), userId: null });

        render(
            <RecipeProviders>
                <SubjectProbe />
            </RecipeProviders>,
        );

        expect(screen.getByText('subject:none')).toBeTruthy();
    });
});

/**
 * ADR-0054: a request is minted only for the cook who made it. Clerk's web `getToken` keeps ONE identity for the app's
 * life, so a client keyed on it survived a change of cook, and its token is read at send time: a recipe or food client
 * built while cook A was signed in sent A's queued or retried work with cook B's token. Each case below reuses one
 * `getToken` across the change, as Clerk does.
 */
describe('RecipeProviders (web) — a client belongs to the cook it was built for', () => {
    /** Captures the recipe and food clients the providers hand down, on every render. */
    function ClientsProbe({
        onClients,
    }: {
        readonly onClients: (recipe: RecipeServiceClient, food: FoodServiceClient) => void;
    }): ReactElement {
        onClients(useRecipeServiceClient(), useFoodServiceClient());

        return <span>clients</span>;
    }

    /** Render the providers for `userId` and return the clients they handed down, plus a way to sign another in. */
    function renderAs(userId: string | null, getToken: unknown) {
        const seen: { recipe: RecipeServiceClient; food: FoodServiceClient }[] = [];
        // A NEW element per render: React skips re-rendering an element it is handed again, which would hide a change.
        const tree = () => (
            <RecipeProviders>
                <ClientsProbe onClients={(recipe, food) => seen.push({ recipe, food })} />
            </RecipeProviders>
        );

        signIn(userId, getToken);
        const view = render(tree());

        return {
            latest: () => seen[seen.length - 1]!,
            switchTo: (next: string | null) => {
                signIn(next, getToken);
                view.rerender(tree());
            },
        };
    }

    it('keeps the same clients while the same cook stays signed in', () => {
        const view = renderAs('user_A', vi.fn().mockResolvedValue('tok-A'));
        const before = view.latest();

        view.switchTo('user_A');

        expect(view.latest().recipe).toBe(before.recipe);
        expect(view.latest().food).toBe(before.food);
    });

    it('builds new clients when another cook signs in', () => {
        const view = renderAs('user_A', vi.fn().mockResolvedValue('tok'));
        const before = view.latest();

        view.switchTo('user_B');

        expect(view.latest().recipe).not.toBe(before.recipe);
        expect(view.latest().food).not.toBe(before.food);
    });

    it('refuses to send cook A’s recipe request with cook B’s session, and sends nothing', async () => {
        const view = renderAs('user_A', vi.fn().mockResolvedValue('tok'));
        const builtForA = view.latest().recipe;

        view.switchTo('user_B');
        const outcome = await builtForA.listRecipes().then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isSessionSubjectChangedError(outcome)).toBe(true);
        expect(apiRequests()).toBe(0);
    });

    it('refuses to send cook A’s food request with cook B’s session, and sends nothing', async () => {
        const view = renderAs('user_A', vi.fn().mockResolvedValue('tok'));
        const builtForA = view.latest().food;

        view.switchTo('user_B');
        const outcome = await builtForA.getById('food_1').then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isSessionSubjectChangedError(outcome)).toBe(true);
        expect(apiRequests()).toBe(0);
    });

    it('refuses cook A’s request once A has signed out', async () => {
        const view = renderAs('user_A', vi.fn().mockResolvedValue('tok'));
        const builtForA = view.latest().recipe;

        view.switchTo(null);
        const outcome = await builtForA.listRecipes().then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isSessionSubjectChangedError(outcome)).toBe(true);
        expect(apiRequests()).toBe(0);
    });

    // The hydration window: the SSR state names the cook before clerk-js has loaded a session, and `getToken` is what
    // waits for the load. The request goes once the session that loads is the cook's, and never if it is not.
    it.each([
        ['sends it when the session that loads is the cook’s', 'user_A', 1],
        ['refuses it when the session that loads is another cook’s', 'user_B', 0],
    ])('%s', async (_case, loaded, sends) => {
        const getToken = vi.fn(async () => {
            clerk.session = { user: { id: loaded } };

            return 'tok';
        });
        const view = renderAs('user_A', getToken);
        clerk.session = undefined;

        await view
            .latest()
            .recipe.listRecipes()
            .catch(() => undefined);

        expect(apiRequests()).toBe(sends);
    });
});

/**
 * ADR-0054: the query cache belongs to one cook at a time. On web a sign-out also reloads the document, which hides a
 * missing boundary; these cases render the root without the reload, so they would catch one.
 */
describe('RecipeProviders (web) — the cache ends with the cook’s session', () => {
    /** Seeds one recipe read into the provided cache and reports how many reads the cache holds. */
    function CacheProbe({ onCache }: { readonly onCache: (client: QueryClient) => void }): ReactElement {
        onCache(useQueryClient());

        return <span>cache</span>;
    }

    function renderSeeded(userId: string | null) {
        let cache: QueryClient | undefined;
        const tree = () => (
            <RecipeProviders>
                <CacheProbe
                    onCache={(client) => {
                        cache = client;
                    }}
                />
            </RecipeProviders>
        );
        const getToken = vi.fn().mockResolvedValue('tok');

        signIn(userId, getToken);
        const view = render(tree());
        cache?.setQueryData(['recipe-service', 'recipes'], { items: ['A’s private soup'] });

        return {
            reads: () => cache?.getQueryCache().getAll().length,
            switchTo: (next: string | null) => {
                signIn(next, getToken);
                view.rerender(tree());
            },
        };
    }

    it.each([
        ['the cook signs out', null],
        ['another cook signs in', 'user_B'],
    ])('removes the last cook’s reads when %s', (_case, next) => {
        const view = renderSeeded('user_A');

        view.switchTo(next);

        expect(view.reads()).toBe(0);
    });

    it('keeps them when a cook signs in from signed out', () => {
        const view = renderSeeded(null);

        view.switchTo('user_A');

        expect(view.reads()).toBe(1);
    });
});

/**
 * ADR-0057, owner D7 (as amended 2026-10-09): the cook's editor drafts and unsent saves end with their session however
 * it ends, not only through our own sign-out command (code-reviewer High 2): another tab's sign-out, a Clerk expiry or
 * revocation and the UserButton all reach this tab only as `useAuth().userId` changing.
 */
describe('RecipeProviders (web) — the cook’s editor work ends with their session', () => {
    async function seedEditorWork(subject: string): Promise<void> {
        await editorDraftsFor(subject)?.save({
            recipeRef: 'local:recipe:a',
            baseVersion: null,
            values: {
                title: 'Soup',
                description: '',
                cuisine: '',
                tags: [],
                dietaryFlags: [],
                servings: 2,
                prepTimeMinutes: 0,
                cookTimeMinutes: 0,
                visibility: 'public',
                ingredients: [],
                steps: [],
            },
            pendingRebinds: [],
            savedAt: '2026-10-09T12:00:00.000Z',
        });
        await outboxMutatorFor(webDeviceStore, subject).mutate((log) =>
            appendIntent(log, { entity: 'recipe', intentKind: 'update', localId: 'rec_1', dependsOn: [], payload: {} }),
        );
    }

    /** Whether the cook's draft and queued write are still in the tab. */
    async function kept(subject: string): Promise<readonly boolean[]> {
        return [
            (await editorDraftsFor(subject)?.load('local:recipe:a')) !== undefined,
            (await loadOutbox(webDeviceStore, subject)).records.length > 0,
        ];
    }

    afterEach(() => {
        window.sessionStorage.clear();
    });

    function renderAs(userId: string | null | undefined) {
        const getToken = vi.fn().mockResolvedValue('tok');
        const tree = () => (
            <RecipeProviders>
                <span>app</span>
            </RecipeProviders>
        );

        useAuthMock.mockReturnValue({ getToken, userId });
        const view = render(tree());

        return {
            switchTo: (next: string | null | undefined) => {
                useAuthMock.mockReturnValue({ getToken, userId: next });
                view.rerender(tree());
            },
        };
    }

    it.each([
        ['the cook signs out (here, in another tab, by expiry or revocation)', null],
        ['another cook signs in', 'user_B'],
    ] as const)('⛔ removes the last cook’s drafts and outbox when %s', async (_case, next) => {
        await seedEditorWork('user_A');
        const view = renderAs('user_A');

        view.switchTo(next);

        await waitFor(async () => expect(await kept('user_A')).toEqual([false, false]));
    });

    it('⛔ keeps them while Clerk is loading, which is not a sign-out', async () => {
        await seedEditorWork('user_A');
        const view = renderAs('user_A');

        view.switchTo(undefined);
        view.switchTo('user_A');
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(await kept('user_A')).toEqual([true, true]);
    });
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

        // Re-render with a DIFFERENT `getToken`. Clerk's own keeps one identity for the provider's life (a
        // `useCallback` on the `IsomorphicClerk` instance), so this guards the closure, not a sign-in.
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
        // ⚠️ `[<(]`, NOT `\(` — `useRef<T>(…)` is the DOMINANT spelling in this repo (`useRecipeEditor`
        // …), and a `\(`-only guard misses every one of them. The
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
        signIn('user_abc', vi.fn().mockResolvedValue('tok'));

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
        signIn('user_abc', vi.fn().mockResolvedValue('tok'));
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
