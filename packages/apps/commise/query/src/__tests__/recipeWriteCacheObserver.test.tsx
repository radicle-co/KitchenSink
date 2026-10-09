/**
 * The outbox's recipe writes reach the TanStack cache (slice 7). The sender calls the client directly, so without this
 * observer a recipe the editor saved through the outbox left My recipes and the detail page showing the old copy.
 */
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import type { Intent, SendResult } from '@kitchensink/sync';

import { RecipeWriteCacheObserver } from '../recipeWriteCacheObserver.js';
import { SyncProvider, useSyncQueue, type SyncQueue } from '../syncProvider.js';

afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
});

function harness(send: (record: unknown) => Promise<SendResult>): {
    readonly client: QueryClient;
    readonly queue: () => SyncQueue;
} {
    const client = new QueryClient();
    let captured: SyncQueue | undefined;

    const Capture = (): ReactElement | null => {
        captured = useSyncQueue();

        return null;
    };

    render(
        <QueryClientProvider client={client}>
            <SyncProvider subject="user_a" send={send as never}>
                <RecipeWriteCacheObserver />
                <Capture />
            </SyncProvider>
        </QueryClientProvider>,
    );

    return {
        client,
        queue: () => {
            if (captured === undefined) {
                throw new Error('not captured');
            }

            return captured;
        },
    };
}

const write = (intentKind: 'create' | 'update', localId: string): Intent => ({
    entity: 'recipe',
    intentKind,
    localId,
    dependsOn: [],
    payload: {},
});

describe('RecipeWriteCacheObserver', () => {
    it('writes an updated recipe through to its detail, and marks the lists stale', async () => {
        const detail = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, title: 'Saved through the outbox' });
        const { client, queue } = harness(
            vi.fn(async () => ({
                outcome: 'ok' as const,
                serverId: 'rec_1',
                answer: { kind: 'recipeWritten', detail },
            })),
        );
        client.setQueryData([...recipeServiceKeys.recipeLists, 'mine'], []);

        await act(async () => {
            await queue().submitExclusive(write('update', 'rec_1'));
        });

        await waitFor(() => expect(client.getQueryData(recipeServiceKeys.recipe('rec_1'))).toStrictEqual(detail));
        expect(client.getQueryState([...recipeServiceKeys.recipeLists, 'mine'])?.isInvalidated).toBe(true);
    });

    it('marks every recipe query stale after a create', async () => {
        const detail = makeRecipeDetail({ id: 'rec_new' });
        const { client, queue } = harness(
            vi.fn(async () => ({
                outcome: 'ok' as const,
                serverId: 'rec_new',
                answer: { kind: 'recipeWritten', detail },
            })),
        );
        client.setQueryData([...recipeServiceKeys.recipeLists, 'mine'], []);

        await act(async () => {
            await queue().submitExclusive(write('create', 'local:recipe:a'));
        });

        await waitFor(() =>
            expect(client.getQueryState([...recipeServiceKeys.recipeLists, 'mine'])?.isInvalidated).toBe(true),
        );
    });

    it('leaves the cache alone for a refusal', async () => {
        const { client, queue } = harness(vi.fn(async () => ({ outcome: 'failed' as const, status: 409 })));
        client.setQueryData([...recipeServiceKeys.recipeLists, 'mine'], []);

        await act(async () => {
            await queue().submitExclusive(write('update', 'rec_1'));
        });

        await waitFor(() => expect(queue().failures).toHaveLength(1));
        expect(client.getQueryState([...recipeServiceKeys.recipeLists, 'mine'])?.isInvalidated).toBe(false);
    });
});
