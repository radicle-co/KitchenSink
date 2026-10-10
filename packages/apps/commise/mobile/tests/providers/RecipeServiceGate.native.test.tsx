/**
 * Component test for `RecipeServiceGate`'s SYNC-QUEUE MOUNT.
 *
 * ⚠️ WRITTEN AFTER the wiring it covers, and said plainly rather than implied: the queue mount shipped in
 * this session's earlier turn and this file closes the coverage gap a review caught. It is written from the
 * CONTRACT below, and both cases are mutation-proven, because a test derived from the code it covers
 * inherits that code's blind spots.
 *
 * THE CONTRACT, which is the whole reason the queue moved down here from `AppProviders`:
 *  1. A signed-in subtree HAS a working queue — `submit` RESOLVES. Mounted above the recipe client (where it
 *     shipped) the queue had no client to send with and its sender could only throw, which is exactly how it
 *     shipped doing nothing.
 *  2. A subtree with NO `userId` still MOUNTS the provider, which refuses `submit` loudly rather than
 *     dropping the write, and reads no storage under a placeholder key. The outbox is namespaced by the
 *     subject, so a placeholder would be a cross-account read the first time a second person signs in on a
 *     device — and a dropped write is the failure this whole layer exists to prevent.
 *  3. The subtree SURVIVES `userId` resolving. Gating the mount changes the element type at that tree
 *     position, so `AuthGate` resolving a user would remount every feature below it — the defect that wiped
 *     the web recipe editor and failed six Playwright shards. Mobile is where that transition is the ORDINARY
 *     boot, because there is no SSR `initialState` to resolve it early as there is on web (ADR-0009).
 *
 * The gate mounts inside `AppProviders`' `QueryClientProvider`, and the food provider below it reads that client (it
 * purges a cook's food reads when their session ends), so every render here mounts one too.
 *
 * ⚠️ `RecipeServiceGate` is imported STATICALLY and there is no `vi.resetModules()`. A first draft used a
 * dynamic import after a reset, which handed the gate a FRESH copy of `@kitchensink/recipe-service-client`
 * with a fresh React context object while this file's `useRecipeServiceClient` kept the original — two
 * context identities, so the provider the gate really does mount was invisible and both cases failed with
 * "must be used within a <RecipeServiceProvider>". The mismatch looked exactly like a missing provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '@clerk/expo';
import { isSessionSubjectChangedError } from '@commise/features-account';
import { useSyncQueue } from '@commise/query/sync';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { useFoodServiceClient, useFoodServiceSubject } from '@kitchensink/food-service-client/hooks';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { Intent } from '@kitchensink/sync';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { RecipeServiceGate } from '../../src/providers/RecipeServiceGate.js';

/** The live session's shape, as the gate reads it from `useClerk()`. */
interface FakeSession {
    readonly user: { readonly id: string };
    readonly getToken: ReturnType<typeof vi.fn>;
}

// ONE object for the whole file, as `useClerk()` hands back one `IsomorphicClerk` for the app's life. Its `session` is
// the LIVE session: the gate mints from it, and the token proxy checks it, so a case moves it to change who is signed in.
const { clerk } = vi.hoisted(() => ({ clerk: { session: null as FakeSession | null } }));

vi.mock('@clerk/expo', () => ({ useAuth: vi.fn(), useClerk: () => clerk }));

vi.mock('../../src/config/env.js', () => ({
    env: {
        EXPO_PUBLIC_RECIPE_API_URL: 'https://recipe.test.invalid',
        EXPO_PUBLIC_FOOD_API_URL: 'https://food.test.invalid',
    },
}));

// The real adapter is AsyncStorage-backed; its STORAGE behaviour is the domain package's own subject, so
// here it is swapped for the domain's OWN in-memory adapter rather than a hand-rolled fake. That is not
// tidiness: the first draft returned `{read, write}` when the port is `{getItem, setItem}`, so the mount
// blew up with "store.getItem is not a function" — a fake store can be wrong in a way the real one cannot.
vi.mock('../../src/storage/outboxStore.js', async () => ({
    createNativeOutboxStore: (await vi.importActual<typeof import('@kitchensink/sync')>('@kitchensink/sync'))
        .createMemoryOutboxStore,
}));

const useAuthMock = vi.mocked(useAuth);

/** The gate around `children`, under a query client, as `AppProviders` mounts it. */
function gated(children: ReactElement, queryClient: QueryClient): ReactElement {
    return (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceGate>{children}</RecipeServiceGate>
        </QueryClientProvider>
    );
}

/** Render the gate around `children`; `rerender` keeps the same query client, as the app does. */
function renderGated(children: ReactElement) {
    const queryClient = new QueryClient();
    const view = render(gated(children, queryClient));

    return { rerender: (next: ReactElement) => view.rerender(gated(next, queryClient)) };
}

const anIntent: Intent = {
    entity: 'recipe',
    intentKind: 'update',
    localId: 'r1',
    dependsOn: [],
    payload: { title: 'Soup' },
};

/**
 * Reports what `submit` actually DID, which is the only honest probe for "is a queue above me?" —
 * `pendingCount` reads 0 whether or not a provider is mounted. Reading the recipe client here is load-bearing
 * too: it THROWS outside its provider, so a render that gets this far has proven the queue sits BELOW the
 * client, which is the defect the move fixed.
 */
function Probe() {
    const queue = useSyncQueue();
    const client = useRecipeServiceClient();
    const [outcome, setOutcome] = useState('pending');

    useEffect(() => {
        queue.submit(anIntent).then(
            () => setOutcome('queued'),
            (error: unknown) => setOutcome(error instanceof Error ? `refused:${error.message}` : 'refused'),
        );
    }, [queue]);

    return <Text>{`${outcome}|${client === null ? 'no-client' : 'client'}`}</Text>;
}

/**
 * Sign `userId` in, as `@clerk/expo` would: `useAuth` names them and hands back a NEW `getToken` on every call (its JWT
 * cache wrapper is rebuilt per render), and the live session is theirs.
 *
 * @param userId - The cook, or `null` for nobody.
 */
function signIn(userId: string | null): void {
    useAuthMock.mockImplementation(
        () => ({ getToken: vi.fn().mockResolvedValue('tok'), userId }) as unknown as ReturnType<typeof useAuth>,
    );
    clerk.session = userId === null ? null : { user: { id: userId }, getToken: vi.fn().mockResolvedValue('tok') };
}

beforeEach(() => {
    signIn('user_abc');
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/**
 * Plan 002 S5: the app reads foods and their variants from food-service directly, at its own origin and with the same
 * native session token the recipe client sends.
 */
describe('RecipeServiceGate — the food client', () => {
    it('provides a food client that calls the food origin with the native session token', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 }));
        vi.stubGlobal('fetch', fetchMock);
        let captured: FoodServiceClient | undefined;

        function FoodProbe() {
            const client = useFoodServiceClient();

            useEffect(() => {
                captured = client;
                void client.getById('food_1').catch(() => undefined);
            }, [client]);

            return <Text>food probe</Text>;
        }

        renderGated(<FoodProbe />);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [input, init] = fetchMock.mock.calls[0] as unknown as [Request | string, RequestInit | undefined];
        const url = typeof input === 'string' ? input : input.url;
        const headers = typeof input === 'string' ? new Headers(init?.headers) : input.headers;

        expect(captured).toBeInstanceOf(FoodServiceClient);
        expect(url).toBe('https://food.test.invalid/api/v1/foods/food_1');
        expect(headers.get('authorization')).toBe('Bearer tok');
    });

    /** Shows the cook the food hooks act for. */
    function SubjectProbe() {
        return <Text>{`subject:${useFoodServiceSubject() ?? 'none'}`}</Text>;
    }

    // Plan 002 S3 property 7: the cook's own food reads are keyed on them and purged when their session ends.
    it('hands the signed-in cook to the food hooks', () => {
        renderGated(<SubjectProbe />);

        expect(screen.getByText('subject:user_abc')).toBeTruthy();
    });

    it('hands no cook to the food hooks while signed out', () => {
        signIn(null);

        renderGated(<SubjectProbe />);

        expect(screen.getByText('subject:none')).toBeTruthy();
    });
});

/**
 * ADR-0054: a request is minted only for the cook who made it. `@clerk/expo` hands back a new `getToken` on every render,
 * so clients keyed on it were rebuilt on every render and a client already held by in-flight work read whoever was signed
 * in at send time. The gate now keys its clients on the cook, mints from the live session, and binds each client to its
 * cook.
 */
describe('RecipeServiceGate — a client belongs to the cook it was built for', () => {
    /** Captures the recipe and food clients the gate hands down, on every render. */
    function ClientsProbe({
        onClients,
    }: {
        readonly onClients: (recipe: RecipeServiceClient, food: FoodServiceClient) => void;
    }) {
        onClients(useRecipeServiceClient(), useFoodServiceClient());

        return <Text>clients</Text>;
    }

    /** Render the gate and return the clients it handed down, plus a way to sign another cook in. */
    function renderAs(userId: string | null) {
        const seen: { recipe: RecipeServiceClient; food: FoodServiceClient }[] = [];
        const probe = <ClientsProbe onClients={(recipe, food) => seen.push({ recipe, food })} />;

        signIn(userId);
        const view = renderGated(probe);

        return {
            latest: () => seen[seen.length - 1]!,
            switchTo: (next: string | null) => {
                signIn(next);
                view.rerender(probe);
            },
        };
    }

    it('keeps the same clients across a re-render for the same cook', () => {
        const view = renderAs('user_A');
        const before = view.latest();

        view.switchTo('user_A');

        expect(view.latest().recipe).toBe(before.recipe);
        expect(view.latest().food).toBe(before.food);
    });

    it('mints from the live session, with the native template', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 }));
        vi.stubGlobal('fetch', fetchMock);
        const view = renderAs('user_A');

        await view
            .latest()
            .food.getById('food_1')
            .catch(() => undefined);

        expect(clerk.session?.getToken).toHaveBeenCalledWith({ template: 'commise-native', skipCache: false });
    });

    // The food client replays a refused request once with a fresh token; skipping Clerk's cache is what makes it fresh.
    it('mints the food client’s replay after a 401 past the token cache', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'expired' }), { status: 401 }),
            )
            .mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));
        vi.stubGlobal('fetch', fetchMock);
        const view = renderAs('user_A');

        await view
            .latest()
            .food.getById('food_1')
            .catch(() => undefined);

        expect(clerk.session?.getToken).toHaveBeenNthCalledWith(1, { template: 'commise-native', skipCache: false });
        expect(clerk.session?.getToken).toHaveBeenNthCalledWith(2, { template: 'commise-native', skipCache: true });
    });

    it.each([
        ['another cook signs in', 'user_B'],
        ['the cook signs out', null],
    ])('refuses cook A’s recipe and food requests once %s, and sends nothing', async (_case, next) => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 }));
        vi.stubGlobal('fetch', fetchMock);
        const view = renderAs('user_A');
        const builtForA = view.latest();

        view.switchTo(next);
        const outcomes = await Promise.all([
            builtForA.recipe.listRecipes().then(
                () => undefined,
                (error: unknown) => error,
            ),
            builtForA.food.getById('food_1').then(
                () => undefined,
                (error: unknown) => error,
            ),
        ]);

        expect(outcomes.map(isSessionSubjectChangedError)).toStrictEqual([true, true]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

/** ADR-0054: the query cache belongs to one cook at a time. Mobile has no reload to hide a missing boundary. */
describe('RecipeServiceGate — the cache ends with the cook’s session', () => {
    /** Render the gate over a cache holding one recipe read, and return the cache plus a way to sign another cook in. */
    function renderSeeded(userId: string | null) {
        const queryClient = new QueryClient();
        const probe = <Text>cache</Text>;

        queryClient.setQueryData(['recipe-service', 'recipes'], { items: ['A’s private soup'] });
        signIn(userId);
        const view = render(gated(probe, queryClient));

        return {
            reads: () => queryClient.getQueryCache().getAll().length,
            switchTo: (next: string | null) => {
                signIn(next);
                view.rerender(gated(probe, queryClient));
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

describe('RecipeServiceGate — the sync queue mount', () => {
    it('mounts a queue that ACCEPTS a write, with the recipe client visible from the same node', async () => {
        renderGated(<Probe />);

        // Both halves in ONE assertion: a queue that cannot see a client is precisely the inert state this
        // move fixed, so proving them separately would let that state pass.
        await waitFor(() => {
            expect(screen.getByText('queued|client')).toBeTruthy();
        });
    });

    /**
     * ⛔ THE REMOUNT GUARD, ON THE PLATFORM WHERE THE TRANSITION IS THE NORMAL CASE. Web got this test first
     * because CI caught the defect there, which is backwards: ADR-0009 records that Clerk's SSR
     * `initialState` is a WEB-specific reason `userId` is already resolved on the first render. Mobile has no
     * SSR state and resolves from secure-store asynchronously, so `null -> string` is the ORDINARY boot here,
     * not an edge case — and mobile shipped the identical ternary with only a prose comment guarding it.
     *
     * Nothing else would catch a reintroduction: Maestro is manual/label-gated, so CI never exercises this
     * flow on a device. §14 cross-platform lockstep says the guard ships on both platforms or neither.
     */
    it('⛔ does NOT remount the subtree when userId resolves from absent to present', async () => {
        signIn(null);

        let mountCount = 0;

        function MountCounter() {
            useEffect(() => {
                mountCount += 1;
            }, []);

            return <Text>counted</Text>;
        }

        const { rerender } = renderGated(<MountCounter />);

        await waitFor(() => expect(screen.getByText('counted')).toBeTruthy());
        expect(mountCount).toBe(1);

        signIn('user_abc');
        rerender(<MountCounter />);

        await waitFor(() => expect(screen.getByText('counted')).toBeTruthy());
        // A second mount effect IS the editor state being wiped — the defect this fix removed.
        expect(mountCount).toBe(1);
    });

    it('refuses the write without a userId — loudly, and children still render', async () => {
        signIn(null);

        renderGated(<Probe />);

        // Refused, not dropped — and the client is still provided, so the subtree renders. An outbox
        // namespaced by a placeholder would be a cross-account read; a blank screen would be a worse cure.
        await waitFor(() => {
            expect(screen.getByText('refused:sync: submit called with no signed-in subject|client')).toBeTruthy();
        });
    });
});
