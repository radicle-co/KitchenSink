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
 * ⚠️ `RecipeServiceGate` is imported STATICALLY and there is no `vi.resetModules()`. A first draft used a
 * dynamic import after a reset, which handed the gate a FRESH copy of `@kitchensink/recipe-service-client`
 * with a fresh React context object while this file's `useRecipeServiceClient` kept the original — two
 * context identities, so the provider the gate really does mount was invisible and both cases failed with
 * "must be used within a <RecipeServiceProvider>". The mismatch looked exactly like a missing provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '@clerk/expo';
import { useSyncQueue } from '@commise/query/sync';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { Intent } from '@kitchensink/sync';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { RecipeServiceGate } from '../../src/providers/RecipeServiceGate.js';

vi.mock('@clerk/expo', () => ({ useAuth: vi.fn() }));

vi.mock('../../src/config/env.js', () => ({
    env: { EXPO_PUBLIC_RECIPE_API_URL: 'https://recipe.test.invalid' },
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

beforeEach(() => {
    useAuthMock.mockReturnValue({
        getToken: vi.fn().mockResolvedValue('tok'),
        userId: 'user_abc',
    } as unknown as ReturnType<typeof useAuth>);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('RecipeServiceGate — the sync queue mount', () => {
    it('mounts a queue that ACCEPTS a write, with the recipe client visible from the same node', async () => {
        render(
            <RecipeServiceGate>
                <Probe />
            </RecipeServiceGate>,
        );

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
        useAuthMock.mockReturnValue({
            getToken: vi.fn().mockResolvedValue('tok'),
            userId: null,
        } as unknown as ReturnType<typeof useAuth>);

        let mountCount = 0;

        function MountCounter() {
            useEffect(() => {
                mountCount += 1;
            }, []);

            return <Text>counted</Text>;
        }

        const { rerender } = render(
            <RecipeServiceGate>
                <MountCounter />
            </RecipeServiceGate>,
        );

        await waitFor(() => expect(screen.getByText('counted')).toBeTruthy());
        expect(mountCount).toBe(1);

        useAuthMock.mockReturnValue({
            getToken: vi.fn().mockResolvedValue('tok'),
            userId: 'user_abc',
        } as unknown as ReturnType<typeof useAuth>);
        rerender(
            <RecipeServiceGate>
                <MountCounter />
            </RecipeServiceGate>,
        );

        await waitFor(() => expect(screen.getByText('counted')).toBeTruthy());
        // A second mount effect IS the editor state being wiped — the defect this fix removed.
        expect(mountCount).toBe(1);
    });

    it('refuses the write without a userId — loudly, and children still render', async () => {
        useAuthMock.mockReturnValue({
            getToken: vi.fn().mockResolvedValue('tok'),
            userId: null,
        } as unknown as ReturnType<typeof useAuth>);

        render(
            <RecipeServiceGate>
                <Probe />
            </RecipeServiceGate>,
        );

        // Refused, not dropped — and the client is still provided, so the subtree renders. An outbox
        // namespaced by a placeholder would be a cross-account read; a blank screen would be a worse cure.
        await waitFor(() => {
            expect(screen.getByText('refused:sync: submit called with no signed-in subject|client')).toBeTruthy();
        });
    });
});
