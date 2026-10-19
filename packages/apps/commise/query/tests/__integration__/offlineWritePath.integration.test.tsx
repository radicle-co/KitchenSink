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
 * - a transient refusal is re-sent, through the real client, after a wait;
 * - at a change of cook mid-drain, the next cook's outbox drains with their token, and the previous cook's answer
 *   reaches neither the wire again nor the next cook's query cache.
 */
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { RecipeServiceClient, recipeServiceKeys } from '@kitchensink/recipe-service-client';
import {
    EMPTY_OUTBOX,
    appendIntent,
    createMemoryOutboxStore,
    loadOutbox,
    markSending,
    saveOutbox,
    settle,
    type Intent,
    type OutboxStore,
} from '@kitchensink/sync';

import { recipeSender } from '../../src/recipeSender.js';
import { RecipeWriteCacheObserver } from '../../src/recipeWriteCacheObserver.js';
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

function Harness({
    intents,
    discards = [],
}: {
    readonly intents: readonly Intent[];
    readonly discards?: readonly Intent[];
}): ReactElement {
    const queue = useSyncQueue();

    return (
        <>
            {discards.map((intent, index) => (
                <button
                    key={`discard-${String(index)}`}
                    type="button"
                    onClick={() => {
                        void queue.discard({ kind: 'entity', intent });
                    }}
                >
                    {`discard ${String(index)}`}
                </button>
            ))}
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

function mount(
    store: OutboxStore,
    fetchDouble: typeof fetch,
    intents: readonly Intent[] = [],
    discards: readonly Intent[] = [],
): void {
    const client = new RecipeServiceClient({ baseUrl: BASE, fetch: fetchDouble, token: 'token' });

    render(
        <SyncProvider subject="user_a" send={recipeSender(() => client)} store={store}>
            <Harness intents={intents} discards={discards} />
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

/**
 * A Discard that cannot leave a record behind (the stuck "Syncing 1"). Each case ends with an EMPTY outbox and the wire
 * traffic the ADR allows: no second POST, and no DELETE for a recipe that was never made.
 */
describe('a Discard settles the outbox through the real client (integration)', () => {
    const deleteOf = (localId: string, dependsOn: readonly string[] = []): Intent => ({
        entity: 'recipe',
        intentKind: 'delete',
        localId,
        dependsOn,
        payload: { id: localId },
    });
    const wire = (calls: readonly Call[]): string[] => calls.map((call) => `${call.method} ${call.path}`);

    /**
     * REWRITTEN (owner ruling 2026-10-17, "Don't allow users to delete while saving"): a Discard pressed while the create
     * is on the wire is REFUSED and leaves the log as it was; once the create parks with an unknown outcome, the Discard
     * withdraws it. Still no second POST, and no DELETE for a recipe that may never have been made.
     */
    it('⛔ a Discard during a create is refused; after the create times out it withdraws it: no second POST, no DELETE', async () => {
        let fail: (() => void) | undefined;
        const network = scriptedFetch([
            async () => {
                await new Promise<void>((_resolve, reject) => {
                    fail = () => {
                        reject(new TypeError('network timeout'));
                    };
                });

                return detail('never', 1);
            },
        ]);
        const store = createMemoryOutboxStore();

        mount(store, network.fetch, [createIntent], [deleteOf('local:recipe:soup', ['local:recipe:soup'])]);
        await press('submit 0');
        await waitFor(() => expect(network.calls).toHaveLength(1));

        await press('discard 0');
        expect((await loadOutbox(store, 'user_a')).records.map((record) => record.intentKind)).toStrictEqual([
            'create',
        ]);

        await act(async () => {
            fail?.();
        });
        await waitFor(async () =>
            expect((await loadOutbox(store, 'user_a')).records.map((record) => record.state)).toStrictEqual(['parked']),
        );

        await press('discard 0');

        await waitFor(async () => expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]));
        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());
        expect(wire(network.calls)).toStrictEqual(['POST /api/v1/recipes']);
    });

    /**
     * REWRITTEN (owner ruling 2026-10-17): the Discard pressed while the update is on the wire is refused; after the 409
     * parks the update, the Discard queues the delete, which gets 204, and the log ends empty.
     */
    it('⛔ a Discard during an update is refused; after its 409 the delete gets 204 and the log ends empty', async () => {
        let conflict: (() => void) | undefined;
        const network = scriptedFetch([
            async () => {
                await new Promise<void>((resolve) => {
                    conflict = resolve;
                });

                return Response.json({ code: 'VERSION_CONFLICT', message: 'stale' }, { status: 409 });
            },
            () => new Response(null, { status: 204 }),
        ]);
        const store = createMemoryOutboxStore();
        const update: Intent = {
            ...updateIntent('Edited'),
            localId: 'srv-soup',
            dependsOn: [],
            payload: { id: 'srv-soup', input: { expectedVersion: 1, title: 'Edited' } },
        };

        mount(store, network.fetch, [update], [deleteOf('srv-soup')]);
        await press('submit 0');
        await waitFor(() => expect(network.calls).toHaveLength(1));

        await press('discard 0');
        expect((await loadOutbox(store, 'user_a')).records.map((record) => record.intentKind)).toStrictEqual([
            'update',
        ]);

        await act(async () => {
            conflict?.();
        });
        await waitFor(async () =>
            expect((await loadOutbox(store, 'user_a')).records.map((record) => record.state)).toStrictEqual(['parked']),
        );

        await press('discard 0');

        await waitFor(async () => expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]));
        expect(wire(network.calls)).toStrictEqual([
            'PATCH /api/v1/recipes/srv-soup',
            'DELETE /api/v1/recipes/srv-soup',
        ]);
    });

    /**
     * REWRITTEN (GATE round 3, B1): the second answer was `NOT_FOUND`, the service's route-level code, which says
     * nothing about the recipe. Only `RECIPE_NOT_FOUND` means the first copy landed.
     */
    it('⛔ a delete times out and parks, is sent again, gets RECIPE_NOT_FOUND, and the log ends empty', async () => {
        const network = scriptedFetch([
            () => {
                throw new TypeError('network timeout');
            },
            () => Response.json({ code: 'RECIPE_NOT_FOUND', message: 'Recipe srv-soup not found.' }, { status: 404 }),
        ]);
        const store = createMemoryOutboxStore();
        await saveOutbox(store, 'user_a', appendIntent(EMPTY_OUTBOX, deleteOf('srv-soup')));

        mount(store, network.fetch);
        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());
        expect((await loadOutbox(store, 'user_a')).records.map((record) => record.state)).toStrictEqual(['parked']);

        await act(async () => {
            onlineManager.setOnline(false);
        });
        await act(async () => {
            onlineManager.setOnline(true);
        });

        await waitFor(async () => expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]));
        expect(wire(network.calls)).toStrictEqual([
            'DELETE /api/v1/recipes/srv-soup',
            'DELETE /api/v1/recipes/srv-soup',
        ]);
    });

    /**
     * ⛔ A 404 THE SERVICE DID NOT SAY IS NOT "ALREADY DELETED". With `recipe-pr-{N}` torn down, the shared ALB
     * answers the host with a code-less `text/plain` 404 (ADR-0003). Read as done, the delete synced and settled away
     * the parked update of a recipe that still exists.
     */
    it("⛔ a delete that gets the ALB's text/plain 404 parks, and the recipe's parked update survives", async () => {
        const network = scriptedFetch([
            () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } }),
        ]);
        const store = createMemoryOutboxStore();
        const update: Intent = {
            ...updateIntent('Edited'),
            localId: 'srv-soup',
            dependsOn: [],
            payload: { id: 'srv-soup', input: { expectedVersion: 1, title: 'Edited' } },
        };
        // A conflict park: the drain does not re-send it, so only the delete reaches the wire.
        const seeded = appendIntent(
            settle(appendIntent(EMPTY_OUTBOX, update), { seq: 1, outcome: 'parked', status: 409 }),
            deleteOf('srv-soup'),
        );
        await saveOutbox(store, 'user_a', seeded);
        expect(seeded.records.map((record) => [record.intentKind, record.state])).toStrictEqual([
            ['update', 'parked'],
            ['delete', 'pending'],
        ]);

        mount(store, network.fetch);

        await waitFor(() => expect(screen.getByText('failed:2')).toBeTruthy());
        expect(
            (await loadOutbox(store, 'user_a')).records.map((record) => [
                record.intentKind,
                record.state,
                record.lastStatus,
            ]),
        ).toStrictEqual([
            ['update', 'parked', 409],
            ['delete', 'parked', 404],
        ]);
        expect(wire(network.calls)).toStrictEqual(['DELETE /api/v1/recipes/srv-soup']);
    });
});

/**
 * ⛔ A CHANGE OF COOK WHILE A REQUEST IS ON THE WIRE (ADR-0054 §4), through the real client, sender and cache observer.
 * Each cook has their own client and token, as both app roots build them per cook.
 */
describe('a change of cook mid-drain (integration)', () => {
    const updateOf = (id: string): Intent => ({
        entity: 'recipe',
        intentKind: 'update',
        localId: id,
        dependsOn: [],
        payload: { id, input: { expectedVersion: 1, title: id } },
    });

    it('⛔ drains the next cook`s outbox with their token, and keeps the previous cook`s answer out of their cache', async () => {
        const store = createMemoryOutboxStore();
        await saveOutbox(
            store,
            'cook_a',
            appendIntent(appendIntent(EMPTY_OUTBOX, updateOf('srv-a1')), updateOf('srv-a2')),
        );
        await saveOutbox(store, 'cook_b', appendIntent(EMPTY_OUTBOX, updateOf('srv-b1')));
        const wire: string[] = [];
        let release: (() => void) | undefined;
        const fetchDouble = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = input instanceof Request ? input : new Request(input, init);
            const path = new URL(request.url).pathname;

            if (path === '/health') {
                return Response.json({ status: 'ok' });
            }

            const id = path.split('/').at(-1) ?? '';

            wire.push(`${request.headers.get('authorization') ?? 'none'} ${request.method} ${path}`);

            if (id === 'srv-a1') {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            }

            return detail(id, 2);
        }) as unknown as typeof fetch;

        const senderFor = (token: string): ReturnType<typeof recipeSender> => {
            const client = new RecipeServiceClient({ baseUrl: BASE, fetch: fetchDouble, token });

            return recipeSender(() => client);
        };

        const queryClient = new QueryClient();
        const tree = (subject: string, send: ReturnType<typeof recipeSender>): ReactElement => (
            <QueryClientProvider client={queryClient}>
                <SyncProvider subject={subject} send={send} store={store}>
                    <RecipeWriteCacheObserver />
                </SyncProvider>
            </QueryClientProvider>
        );

        const view = render(tree('cook_a', senderFor('token-a')));
        await waitFor(() => expect(wire).toStrictEqual(['Bearer token-a PATCH /api/v1/recipes/srv-a1']));

        view.rerender(tree('cook_b', senderFor('token-b')));

        await waitFor(() =>
            expect(wire).toStrictEqual([
                'Bearer token-a PATCH /api/v1/recipes/srv-a1',
                'Bearer token-b PATCH /api/v1/recipes/srv-b1',
            ]),
        );
        await waitFor(() => expect(queryClient.getQueryData(recipeServiceKeys.recipe('srv-b1'))).toBeDefined());

        await act(async () => {
            release?.();
        });

        await waitFor(async () =>
            expect((await loadOutbox(store, 'cook_a')).records.map((record) => record.localId)).toStrictEqual([
                'srv-a2',
            ]),
        );
        expect(wire).toHaveLength(2);
        // ⛔ Cook A's private recipe never enters the cache cook B reads.
        expect(queryClient.getQueryData(recipeServiceKeys.recipe('srv-a1'))).toBeUndefined();
        expect((await loadOutbox(store, 'cook_b')).records).toStrictEqual([]);
    });
});

/**
 * Combative audit M3 (2026-10-19): a Discard deletes a draft the server holds through the outbox, and the sender calls
 * the client directly, so nothing told the cache. My recipes kept showing the deleted draft. Composed here from the real
 * sender, client and observer, with only the network a double.
 */
describe('a synced delete refreshes what showed the recipe (integration)', () => {
    it('⛔ a Discard that deletes a held draft marks My recipes, search and collections stale', async () => {
        const network = scriptedFetch([() => new Response(null, { status: 204 })]);
        const store = createMemoryOutboxStore();
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: network.fetch, token: 'token' });
        const queryClient = new QueryClient();
        queryClient.setQueryData([...recipeServiceKeys.recipeLists, 'mine'], []);
        queryClient.setQueryData([...recipeServiceKeys.recipeSearches, 'soup'], []);
        queryClient.setQueryData([...recipeServiceKeys.collections, 'list'], []);
        const discardSoup: Intent = {
            entity: 'recipe',
            intentKind: 'delete',
            localId: 'srv-soup',
            dependsOn: [],
            payload: { id: 'srv-soup' },
        };

        render(
            <QueryClientProvider client={queryClient}>
                <SyncProvider subject="user_a" send={recipeSender(() => client)} store={store}>
                    <RecipeWriteCacheObserver />
                    <Harness intents={[]} discards={[discardSoup]} />
                </SyncProvider>
            </QueryClientProvider>,
        );
        await press('discard 0');

        await waitFor(async () => expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]));
        expect(network.calls.map((call) => `${call.method} ${call.path}`)).toStrictEqual([
            'DELETE /api/v1/recipes/srv-soup',
        ]);
        await waitFor(() =>
            expect(queryClient.getQueryState([...recipeServiceKeys.recipeLists, 'mine'])?.isInvalidated).toBe(true),
        );
        expect(queryClient.getQueryState([...recipeServiceKeys.recipeSearches, 'soup'])?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState([...recipeServiceKeys.collections, 'list'])?.isInvalidated).toBe(true);
    });
});
