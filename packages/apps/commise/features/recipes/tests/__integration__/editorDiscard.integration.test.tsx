/**
 * Discard while the create is parked, over the REAL outbox (`outboxPort.ts`: the `@kitchensink/sync` mutator, drain and
 * journal behind the editor's port; only `fetch` behind the recipe client is a double).
 *
 * code-reviewer High 1: the editor withdrew the parked create and then queued a delete naming the create's local ref as
 * its dependency. The create was gone, so the delete waited in the journal forever and "not synced" never cleared — on
 * mobile, in AsyncStorage. The fake port in the unit tier cannot show a record STUCK in a journal; this tier can.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { DEFAULT_REQUEST_TIMEOUT_MS, RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DraftStore } from '../../src/editor/draftStore.js';
import { useRecipeEditor } from '../../src/hooks/useRecipeEditor.js';
import { makeOutboxPort } from './outboxPort.js';

afterEach(cleanup);

const NO_DRAFTS: DraftStore = {
    load: async () => undefined,
    save: async () => undefined,
    discard: async () => undefined,
    adopt: async () => undefined,
    clear: async () => undefined,
};

/** A recipe client whose create fails the way `fails` says, and which records every request it is sent. */
function failingCreates(fails: () => Promise<Response>) {
    const requests: string[] = [];
    const client = new RecipeServiceClient({
        baseUrl: 'https://recipes.test',
        token: 'tok',
        fetch: async (input, init) => {
            const request = new Request(input, init);
            requests.push(`${request.method} ${new URL(request.url).pathname}`);

            return fails();
        },
    });

    return { client, requests };
}

function mountEditor(client: RecipeServiceClient) {
    const outbox = makeOutboxPort(client);
    const onExit = vi.fn();
    const view = renderHook(() =>
        useRecipeEditor(
            {},
            {
                locale: 'en',
                port: outbox.port,
                drafts: NO_DRAFTS,
                keep: 'disk',
                onExit,
                rebindLine: vi.fn(),
                readRecipe: (id) => client.getRecipeById(id),
            },
        ),
    );

    return { ...view, ...outbox, onExit };
}

async function parkTheCreate(view: ReturnType<typeof mountEditor>): Promise<void> {
    act(() => {
        view.result.current.setField('title', 'Soup');
    });
    act(() => {
        view.result.current.checkpoint('sectionChange');
    });
    await act(async () => {
        await view.idle();
    });
    await waitFor(() => expect(view.result.current.parked).toBeDefined());
}

describe('Discard while the create is parked (real outbox)', () => {
    it('a refused create: the journal is left empty — no delete waits for a create that is gone', async () => {
        const { client, requests } = failingCreates(async () =>
            Response.json({ error: { code: 'VALIDATION' } }, { status: 400 }),
        );
        const view = mountEditor(client);
        await parkTheCreate(view);

        expect(view.result.current.parked).toEqual({ failure: 'terminal', kind: 'create' });
        expect(view.result.current.discardMayLeaveServerCopy).toBe(false);

        act(() => {
            view.result.current.discard();
        });
        await act(async () => {
            await view.idle();
        });

        await waitFor(async () => expect(await view.records()).toEqual([]));
        // One create was sent, and no delete ever was (the client's own `/health` probe after a refusal is not ours).
        expect(requests.filter((request) => request.includes('/api/v1/recipes'))).toEqual(['POST /api/v1/recipes']);
        expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' });
    });

    it('a create whose outcome is unknown: the cook is told it may exist, and the journal is still left empty', async () => {
        const { client, requests } = failingCreates(() => Promise.reject(new TypeError('Failed to fetch')));
        const view = mountEditor(client);
        await parkTheCreate(view);

        expect(view.result.current.parked).toEqual({ failure: 'unknown', kind: 'create' });
        expect(view.result.current.discardMayLeaveServerCopy).toBe(true);

        act(() => {
            view.result.current.discard();
        });
        await act(async () => {
            await view.idle();
        });

        await waitFor(async () => expect(await view.records()).toEqual([]));
        // One create was sent, and no delete ever was (the client's own `/health` probe after a refusal is not ours).
        expect(requests.filter((request) => request.includes('/api/v1/recipes'))).toEqual(['POST /api/v1/recipes']);
    });
});

/**
 * Discard while the create is ON THE WIRE (finding 2 of the 2026-10-10 review). Discard used to queue a delete behind
 * the create and close; when the create then parked, nothing withdrew it, and the parked create and its delete stayed
 * in the journal. Discard now waits for the create's answer. The create's response is held until the test releases it
 * with the answer it chooses.
 */
describe('Discard while the create is on the wire (real outbox)', () => {
    const RECIPE_ID = '00000000-0000-4000-8000-00000000c001';

    /**
     * A client whose first create waits for `answer`, and which answers a delete with 204. `timeoutMs` is the client's
     * per-attempt timeout, raised above the Discard's bound by the test of that bound so the bound fires first.
     */
    function heldCreate(timeoutMs?: number) {
        const requests: string[] = [];
        let answer: (response: Response | Error) => void = () => undefined;
        const held = new Promise<Response | Error>((resolve) => (answer = resolve));
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.test',
            token: 'tok',
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            fetch: async (input, init) => {
                const request = new Request(input, init);
                const path = new URL(request.url).pathname;

                if (path === '/health') {
                    return Response.json({});
                }

                requests.push(`${request.method} ${path}`);

                if (request.method === 'DELETE') {
                    return new Response(null, { status: 204 });
                }

                const response = await held;

                if (response instanceof Error) {
                    throw response;
                }

                return response;
            },
        });

        return { client, requests, answer: (response: Response | Error) => answer(response) };
    }

    async function discardOnTheWire(service: ReturnType<typeof heldCreate>) {
        const view = mountEditor(service.client);
        act(() => {
            view.result.current.setField('title', 'Soup');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await waitFor(() => expect(service.requests).toEqual(['POST /api/v1/recipes']));

        act(() => {
            view.result.current.discard();
        });
        await waitFor(() => expect(view.result.current.discarding).toBe(true));

        return view;
    }

    const ours = (requests: readonly string[]) => requests.filter((request) => request.includes('/api/v1/recipes'));

    it('⛔ the create syncs: the recipe is deleted by its id, and the journal is left empty', async () => {
        const service = heldCreate();
        const view = await discardOnTheWire(service);

        service.answer(
            Response.json(makeRecipeDetail({ id: RECIPE_ID, title: 'Soup', status: RecipeStatus.DRAFT }), {
                status: 201,
            }),
        );

        await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' }));
        await waitFor(() =>
            expect(ours(service.requests)).toEqual(['POST /api/v1/recipes', `DELETE /api/v1/recipes/${RECIPE_ID}`]),
        );
        await act(async () => {
            await view.idle();
        });
        expect(await view.records()).toEqual([]);
    });

    it.each([
        ['a dropped connection (unknown outcome)', () => new TypeError('Failed to fetch')],
        ['a refusal', () => Response.json({ error: { code: 'VALIDATION' } }, { status: 400 })],
    ])(
        '⛔ the create parks after %s: it is withdrawn, no delete is sent, and the journal is left empty',
        async (_case, make) => {
            const service = heldCreate();
            const view = await discardOnTheWire(service);

            service.answer(make());

            await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' }));
            await waitFor(async () => expect(await view.records()).toEqual([]));
            expect(ours(service.requests)).toEqual(['POST /api/v1/recipes']);
        },
    );

    /**
     * The bound. A send that never answers parks at the client's own per-attempt timeout, which started before the
     * press, so the bound is reached only when retries stretch a send past it; this client's timeout is raised to stand
     * for that. Past the bound the delete waits behind the create, so a create that still syncs is deleted.
     */
    it('past the bound: the editor closes, and a create that syncs later is still deleted by its id', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });

        try {
            const service = heldCreate(10 * DEFAULT_REQUEST_TIMEOUT_MS);
            const view = await discardOnTheWire(service);

            await act(async () => {
                vi.advanceTimersByTime(DEFAULT_REQUEST_TIMEOUT_MS);
            });
            await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' }));
            expect(ours(service.requests)).toEqual(['POST /api/v1/recipes']);

            service.answer(
                Response.json(makeRecipeDetail({ id: RECIPE_ID, title: 'Soup', status: RecipeStatus.DRAFT }), {
                    status: 201,
                }),
            );

            await waitFor(() =>
                expect(ours(service.requests)).toEqual(['POST /api/v1/recipes', `DELETE /api/v1/recipes/${RECIPE_ID}`]),
            );
            await waitFor(async () => expect(await view.records()).toEqual([]));
        } finally {
            vi.useRealTimers();
        }
    });

    it('the editor is left while it waits: no hand-off, and a create that syncs later is still deleted', async () => {
        const service = heldCreate();
        const view = await discardOnTheWire(service);

        view.unmount();
        service.answer(
            Response.json(makeRecipeDetail({ id: RECIPE_ID, title: 'Soup', status: RecipeStatus.DRAFT }), {
                status: 201,
            }),
        );

        await waitFor(() =>
            expect(ours(service.requests)).toEqual(['POST /api/v1/recipes', `DELETE /api/v1/recipes/${RECIPE_ID}`]),
        );
        await waitFor(async () => expect(await view.records()).toEqual([]));
        expect(view.onExit).not.toHaveBeenCalled();
    });

    it('a create still queued (offline): both go at once, and nothing is ever sent', async () => {
        const service = heldCreate();
        const view = mountEditor(service.client);
        view.setOnline(false);
        act(() => {
            view.result.current.setField('title', 'Soup');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await waitFor(async () => expect(await view.records()).toHaveLength(1));

        act(() => {
            view.result.current.discard();
        });

        await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' }));
        expect(await view.records()).toEqual([]);
        view.setOnline(true);
        await act(async () => {
            await view.idle();
        });
        expect(ours(service.requests)).toEqual([]);
    });

    it('a new recipe nothing was sent for: the outbox queues no delete, and the journal stays empty', async () => {
        const service = heldCreate();
        const view = mountEditor(service.client);
        act(() => {
            view.result.current.setField('description', 'Below the draft floor: no create.');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });

        act(() => {
            view.result.current.discard();
        });

        await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' }));
        expect(await view.records()).toEqual([]);
        expect(ours(service.requests)).toEqual([]);
    });
});
