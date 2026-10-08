/**
 * The offline write path composed from its real parts: `SyncProvider`, the outbox mutator and drainer
 * (`@kitchensink/sync`), `recipeSender`, and the real `RecipeServiceClient` with its zod parsing. Only the network is
 * a double — `fetch` (owner ruling 2026-09-20: integration tests mock their dependencies).
 *
 * The unit tiers prove each part against doubles of the others. What only the composition can show:
 *
 * - a queued `create` and the `update` that depends on it reach the wire in order, the update addressed to the id
 *   the server minted — including when the update was queued AFTER the create had already synced;
 * - a write submitted while another is on the wire is not lost from storage;
 * - a request a previous process left mid-send is never re-sent, and is reported for the cook;
 * - a transient refusal is re-sent, through the real client, after a wait.
 */
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import {
    EMPTY_OUTBOX,
    appendIntent,
    createMemoryOutboxStore,
    loadOutbox,
    markSending,
    saveOutbox,
    type Intent,
    type OutboxStore,
} from '@kitchensink/sync';

import { recipeSender } from '../../src/recipeSender.js';
import { SyncProvider, useSyncQueue } from '../../src/syncProvider.js';

const BASE = 'https://recipes.test';

interface Call {
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
}

/** A `fetch` double that answers each API request from a script, and records it. */
function scriptedFetch(answers: readonly ((call: Call) => Response | Promise<Response>)[]): {
    readonly fetch: typeof fetch;
    readonly calls: Call[];
} {
    const calls: Call[] = [];
    const queue = [...answers];
    const fetchDouble = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = input instanceof Request ? input : new Request(input, init);
        const text = await request.text();
        const call: Call = {
            method: request.method,
            path: new URL(request.url).pathname,
            body: text === '' ? undefined : (JSON.parse(text) as unknown),
        };

        // The client's contract-skew probe (`GET /health`, drift layer 3) is not a write and is not scripted.
        if (call.path === '/health') {
            return Response.json({ status: 'ok' });
        }

        calls.push(call);

        const answer = queue.shift();

        if (answer === undefined) {
            throw new Error(`unscripted request: ${call.method} ${call.path}`);
        }

        return answer(call);
    });

    return { fetch: fetchDouble as unknown as typeof fetch, calls };
}

const detail = (id: string, currentVersion: number): Response =>
    Response.json(makeRecipeDetail({ id, currentVersion }), { status: currentVersion === 1 ? 201 : 200 });

const CREATE_INPUT = {
    title: 'Soup',
    status: 'draft',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [],
    steps: [],
};

const createIntent: Intent = {
    entity: 'recipe',
    intentKind: 'create',
    localId: 'local:recipe:soup',
    produces: 'local:recipe:soup',
    dependsOn: [],
    payload: { input: CREATE_INPUT },
};

const updateIntent = (title: string): Intent => ({
    entity: 'recipe',
    intentKind: 'update',
    localId: 'local:recipe:soup',
    dependsOn: ['local:recipe:soup'],
    payload: { id: 'local:recipe:soup', input: { expectedVersion: 1, title } },
});

function Harness({ intents }: { readonly intents: readonly Intent[] }): ReactElement {
    const queue = useSyncQueue();

    return (
        <>
            {intents.map((intent, index) => (
                <button
                    key={`${intent.intentKind}-${String(index)}`}
                    type="button"
                    onClick={() => {
                        void queue.submit(intent);
                    }}
                >
                    {`submit ${String(index)}`}
                </button>
            ))}
            <span>pending:{queue.pendingCount}</span>
            <span>failed:{queue.failures.length}</span>
        </>
    );
}

function mount(store: OutboxStore, fetchDouble: typeof fetch, intents: readonly Intent[] = []): void {
    const client = new RecipeServiceClient({ baseUrl: BASE, fetch: fetchDouble, token: 'token' });

    render(
        <SyncProvider subject="user_a" send={recipeSender(() => client)} store={store}>
            <Harness intents={intents} />
        </SyncProvider>,
    );
}

async function press(name: string): Promise<void> {
    await act(async () => {
        screen.getByRole('button', { name }).click();
    });
}

afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
});

describe('the offline write path (integration)', () => {
    it('sends a queued create, then its update addressed to the id the server minted', async () => {
        act(() => {
            onlineManager.setOnline(false);
        });
        const network = scriptedFetch([() => detail('srv-soup', 1), () => detail('srv-soup', 2)]);
        const store = createMemoryOutboxStore();

        mount(store, network.fetch, [createIntent, updateIntent('Soup, edited')]);
        await press('submit 0');
        await press('submit 1');
        expect(network.calls).toStrictEqual([]);

        await act(async () => {
            onlineManager.setOnline(true);
        });

        await waitFor(() => expect(network.calls.map((call) => `${call.method} ${call.path}`)).toHaveLength(2));
        expect(network.calls.map((call) => `${call.method} ${call.path}`)).toStrictEqual([
            'POST /api/v1/recipes',
            'PATCH /api/v1/recipes/srv-soup',
        ]);
        expect(network.calls[1]?.body).toStrictEqual({ expectedVersion: 1, title: 'Soup, edited' });
        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());
    });

    /**
     * ⛔ THE EDITOR'S CHECKPOINT FLOW (blueprint A4): later checkpoints are updates that depend on the create's local
     * ref, and most are queued long after the create synced. Its producer is gone from the log by then; only the
     * persisted resolutions can address it.
     */
    it('⛔ addresses an update queued after its create had synced', async () => {
        const network = scriptedFetch([() => detail('srv-soup', 1), () => detail('srv-soup', 2)]);
        const store = createMemoryOutboxStore();

        mount(store, network.fetch, [createIntent, updateIntent('Later')]);
        await press('submit 0');
        await waitFor(() => expect(network.calls).toHaveLength(1));
        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());

        await press('submit 1');

        await waitFor(() => expect(network.calls).toHaveLength(2));
        expect(network.calls[1]?.path).toBe('/api/v1/recipes/srv-soup');
    });

    it('⛔ keeps, and sends, a write submitted while another was on the wire', async () => {
        let release: (() => void) | undefined;
        const network = scriptedFetch([
            async () => {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });

                return detail('srv-a', 2);
            },
            () => detail('srv-b', 2),
        ]);
        const store = createMemoryOutboxStore();
        const a: Intent = {
            ...updateIntent('A'),
            localId: 'srv-a',
            dependsOn: [],
            payload: { id: 'srv-a', input: { expectedVersion: 1, title: 'A' } },
        };
        const b: Intent = {
            ...updateIntent('B'),
            localId: 'srv-b',
            dependsOn: [],
            payload: { id: 'srv-b', input: { expectedVersion: 1, title: 'B' } },
        };

        mount(store, network.fetch, [a, b]);
        await press('submit 0');
        await waitFor(() => expect(network.calls).toHaveLength(1));

        await press('submit 1');
        expect((await loadOutbox(store, 'user_a')).records.map((record) => record.localId)).toStrictEqual([
            'srv-a',
            'srv-b',
        ]);

        await act(async () => {
            release?.();
        });

        await waitFor(() => expect(network.calls.map((call) => call.path)).toHaveLength(2));
        expect(network.calls[1]?.path).toBe('/api/v1/recipes/srv-b');
        await waitFor(async () => expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]));
    });

    /**
     * ⛔ A DELETE THAT LANDS WHILE THE DRAIN IS BUSY WINS OVER THE CREATE STILL WAITING ITS TURN. The drain read the
     * create in its snapshot; the cook deleted the recipe before the create's turn came. The create must never reach
     * the server, or the server keeps a recipe the cook removed.
     */
    it('⛔ never sends a create the cook deleted while an earlier write was on the wire', async () => {
        let release: (() => void) | undefined;
        const network = scriptedFetch([
            async () => {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });

                return detail('srv-other', 2);
            },
        ]);
        const store = createMemoryOutboxStore();
        const other: Intent = {
            ...updateIntent('Other'),
            localId: 'srv-other',
            dependsOn: [],
            payload: { id: 'srv-other', input: { expectedVersion: 1, title: 'Other' } },
        };
        const deleteSoup: Intent = {
            entity: 'recipe',
            intentKind: 'delete',
            localId: 'local:recipe:soup',
            dependsOn: [],
            payload: { id: 'local:recipe:soup' },
        };

        act(() => {
            onlineManager.setOnline(false);
        });
        mount(store, network.fetch, [other, createIntent, deleteSoup]);
        await press('submit 0');
        await press('submit 1');
        await act(async () => {
            onlineManager.setOnline(true);
        });
        await waitFor(() => expect(network.calls).toHaveLength(1));

        // The drain is now on the wire with `other`, holding a snapshot that still has the create in it.
        const queue = await loadOutbox(store, 'user_a');
        expect(queue.records.map((record) => record.intentKind)).toStrictEqual(['update', 'create']);

        await press('submit 2');
        await act(async () => {
            release?.();
        });

        await waitFor(async () => expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]));
        expect(network.calls.map((call) => `${call.method} ${call.path}`)).toStrictEqual([
            'PATCH /api/v1/recipes/srv-other',
        ]);
    });

    /** ⛔ THE NO-BLIND-RETRY RULE ACROSS A CRASH: a request a dead process left mid-send may already be applied. */
    it('⛔ never re-sends a request a previous process left mid-send, and reports it', async () => {
        const network = scriptedFetch([]);
        const store = createMemoryOutboxStore();
        await saveOutbox(store, 'user_a', markSending(appendIntent(EMPTY_OUTBOX, updateIntent('Interrupted')), 1));

        mount(store, network.fetch);

        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());
        expect(network.calls).toStrictEqual([]);
        expect((await loadOutbox(store, 'user_a')).records.map((record) => record.state)).toStrictEqual(['parked']);
    });

    it('re-sends a transient refusal through the real client after a wait, then empties the outbox', async () => {
        const network = scriptedFetch([
            () => Response.json({ code: 'SERVICE_UNAVAILABLE', message: 'busy' }, { status: 503 }),
            () => detail('srv-soup', 2),
        ]);
        const store = createMemoryOutboxStore();
        const update: Intent = {
            ...updateIntent('Retry'),
            localId: 'srv-soup',
            dependsOn: [],
            payload: { id: 'srv-soup', input: { expectedVersion: 1, title: 'Retry' } },
        };

        mount(store, network.fetch, [update]);
        await press('submit 0');

        await waitFor(() => expect(network.calls).toHaveLength(2), { timeout: 5_000 });
        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());
    });
});
