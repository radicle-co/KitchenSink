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
import { makeRecipeDetail as makeBaseRecipeDetail } from '@kitchensink/recipe-core/testing';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DraftStore } from '../../src/editor/draftStore.js';
import { useRecipeEditor, type EditorSeed } from '../../src/hooks/useRecipeEditor.js';
import { makeOutboxPort } from './outboxPort.js';

/**
 * A recipe as the editor meets one: with a cuisine, which Publish needs since 2026-10-13. These cases are about the
 * editor's machinery, not the cuisine rule (`form/__tests__/validate.test.ts` owns that).
 */
const makeRecipeDetail = (...[overrides]: Parameters<typeof makeBaseRecipeDetail>) =>
    makeBaseRecipeDetail({ cuisine: 'Italian', ...overrides });

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

function mountEditor(client: RecipeServiceClient, seed: EditorSeed = {}) {
    const outbox = makeOutboxPort(client);
    const onExit = vi.fn();
    const view = renderHook(() =>
        useRecipeEditor(seed, {
            locale: 'en',
            privateRefusal: undefined,
            port: outbox.port,
            drafts: NO_DRAFTS,
            keep: 'disk',
            onExit,
            reportError: vi.fn(),
            rebindLine: vi.fn(),
            readRecipe: (id) => client.getRecipeById(id),
        }),
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
 * Discard while the create is ON THE WIRE. REWRITTEN for the owner ruling 2026-10-17, "Don't allow users to delete while
 * saving". The editor used to WAIT for the create's answer (a busy confirm, a bound, then a delete queued behind the
 * create); a create whose reply was lost then left a recipe standing that the cook had been told was gone (review M3).
 * Now the control is unavailable while the create is on the wire and the outbox refuses a Discard that gets through; it
 * comes back when the create is answered or parks, an unknown outcome included. The create's response is held until the
 * test releases it with the answer it chooses. Coverage moved: the create-answers cases are below; the bound, the
 * delete-behind-the-create and the unmount-mid-wait cases have no successor because that state no longer exists.
 */
describe('Discard while the create is on the wire (real outbox)', () => {
    const RECIPE_ID = '00000000-0000-4000-8000-00000000c001';

    /** A client whose first create waits for `answer`, and which answers a delete with 204. */
    function heldCreate() {
        const requests: string[] = [];
        let answer: (response: Response | Error) => void = () => undefined;
        const held = new Promise<Response | Error>((resolve) => (answer = resolve));
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.test',
            token: 'tok',
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

    /** The editor with its create on the wire, and the hook re-rendered the way the app's context re-renders it. */
    async function createOnTheWire(service: ReturnType<typeof heldCreate>) {
        const view = mountEditor(service.client);
        act(() => {
            view.result.current.setField('title', 'Soup');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await waitFor(() => expect(service.requests).toEqual(['POST /api/v1/recipes']));
        await waitFor(() => {
            view.rerender();
            expect(view.result.current.writeInFlight).toBe(true);
        });

        return view;
    }

    const ours = (requests: readonly string[]) => requests.filter((request) => request.includes('/api/v1/recipes'));

    it('⛔ while the create is on the wire, Discard does nothing: no delete is queued or sent, and the editor stays', async () => {
        const service = heldCreate();
        const view = await createOnTheWire(service);

        act(() => {
            view.result.current.discard();
        });
        // Not `idle()`: that waits for the held create, which only the test answers.
        await act(async () => {
            await Promise.resolve();
        });

        expect(view.result.current.discarding).toBe(false);
        expect(view.onExit).not.toHaveBeenCalled();
        expect((await view.records()).map((record) => [record.intentKind, record.state])).toEqual([
            ['create', 'sending'],
        ]);
        expect(ours(service.requests)).toEqual(['POST /api/v1/recipes']);
    });

    /**
     * ⛔ THE DOMAIN REFUSES, NOT ONLY THE BUTTON. A Discard that reaches the outbox while the create is on the wire (a press
     * that raced the drain's claim) is answered `refused`, and the journal is exactly as it was: no delete waits behind
     * the create to be swallowed with it when its reply is lost.
     */
    it('⛔ the real outbox refuses a Discard asked of it while the create is on the wire, and changes nothing', async () => {
        const service = heldCreate();
        const view = await createOnTheWire(service);
        const before = await view.records();
        const ref = before[0]?.localId ?? '';

        const outcome = await view.port.discard({
            kind: 'entity',
            intent: {
                entity: 'recipe',
                intentKind: 'delete',
                localId: ref,
                dependsOn: [ref],
                payload: { id: ref },
            },
        });

        expect(outcome).toEqual({ kind: 'refused', reason: 'writeInFlight' });
        expect(await view.records()).toEqual(before);
    });

    it('⛔ the create syncs: the control comes back, and Discard deletes the recipe by its id', async () => {
        const service = heldCreate();
        const view = await createOnTheWire(service);

        service.answer(
            Response.json(makeRecipeDetail({ id: RECIPE_ID, title: 'Soup', status: RecipeStatus.DRAFT }), {
                status: 201,
            }),
        );
        await waitFor(() => {
            view.rerender();
            expect(view.result.current.writeInFlight).toBe(false);
        });

        act(() => {
            view.result.current.discard();
        });

        await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' }));
        await waitFor(() =>
            expect(ours(service.requests)).toEqual(['POST /api/v1/recipes', `DELETE /api/v1/recipes/${RECIPE_ID}`]),
        );
        await act(async () => {
            await view.idle();
        });
        expect(await view.records()).toEqual([]);
    });

    /**
     * ⛔ THE UNKNOWN OUTCOME (the review's M3, and the ruling's own question). The reply is lost and the create parks with no
     * status. The control must come back, and a Discard then withdraws the create. It cannot become a delete by the
     * record's id: a create carries no client id (ADR-0057), so there is no id to delete by, and a delete naming the
     * local ref would wait for ever. The cook is told the recipe may already be saved (`discardMayLeaveServerCopy`).
     */
    it('⛔ the create parks after a dropped connection (unknown): the control comes back; Discard withdraws it and warns', async () => {
        const service = heldCreate();
        const view = await createOnTheWire(service);

        service.answer(new TypeError('Failed to fetch'));
        await waitFor(() => {
            view.rerender();
            expect(view.result.current.writeInFlight).toBe(false);
            expect(view.result.current.parked).toEqual({ failure: 'unknown', kind: 'create' });
        });

        expect(view.result.current.discardMayLeaveServerCopy).toBe(true);

        act(() => {
            view.result.current.discard();
        });

        await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' }));
        await waitFor(async () => expect(await view.records()).toEqual([]));
        expect(ours(service.requests)).toEqual(['POST /api/v1/recipes']);
    });

    it('⛔ the create parks after a refusal: the control comes back; Discard withdraws it, with no warning owed', async () => {
        const service = heldCreate();
        const view = await createOnTheWire(service);

        service.answer(Response.json({ error: { code: 'VALIDATION' } }, { status: 400 }));
        await waitFor(() => {
            view.rerender();
            expect(view.result.current.writeInFlight).toBe(false);
            expect(view.result.current.parked).toEqual({ failure: 'terminal', kind: 'create' });
        });

        expect(view.result.current.discardMayLeaveServerCopy).toBe(false);

        act(() => {
            view.result.current.discard();
        });

        await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'discarded' }));
        await waitFor(async () => expect(await view.records()).toEqual([]));
        expect(ours(service.requests)).toEqual(['POST /api/v1/recipes']);
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

/**
 * A published recipe whose earlier Save changes parked, then Discard (plan 2026-10-13-004, item 5). The plan used to
 * leave the parked update in the journal for ever. The cook's confirmed Discard withdraws it, and the editor hands off
 * to the recipe, which reads the server's copy.
 */
describe('Discard of a published recipe with a parked Save changes (real outbox)', () => {
    const PUBLISHED = makeRecipeDetail({ id: 'rec_pub', currentVersion: 3, status: RecipeStatus.PUBLISHED });

    function refusingUpdates(status: number | 'drop') {
        const requests: string[] = [];
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.test',
            token: 'tok',
            fetch: async (input, init) => {
                const request = new Request(input, init);
                const path = new URL(request.url).pathname;

                if (path === '/health') {
                    return Response.json({});
                }

                requests.push(`${request.method} ${path}`);

                if (status === 'drop') {
                    throw new TypeError('Failed to fetch');
                }

                return Response.json({ error: { code: 'VALIDATION' } }, { status });
            },
        });

        return { client, requests };
    }

    it.each([
        ['a refused save', 400, false],
        ['a save whose outcome is unknown', 'drop', true],
    ] as const)('%s: Discard empties the journal and leaves for the recipe', async (_case, status, mayStand) => {
        const { client, requests } = refusingUpdates(status);
        const view = mountEditor(client, { recipe: PUBLISHED });

        act(() => {
            view.result.current.setField('description', 'Mine.');
        });
        act(() => {
            view.result.current.saveChanges('');
        });
        await act(async () => {
            await view.idle();
        });
        await waitFor(() => expect(view.result.current.parked).toBeDefined());

        expect(view.result.current.hasUnsavedChanges).toBe(true);
        expect(view.result.current.discardSavedChangesMayStand).toBe(mayStand);

        act(() => {
            view.result.current.discard();
        });

        await waitFor(() => expect(view.onExit).toHaveBeenCalledWith({ kind: 'leftForRecipe', recipeId: 'rec_pub' }));
        await waitFor(async () => expect(await view.records()).toEqual([]));
        expect(requests.filter((request) => request.startsWith('PATCH'))).toHaveLength(1);
        expect(requests.filter((request) => request.startsWith('DELETE'))).toEqual([]);
    });
});
