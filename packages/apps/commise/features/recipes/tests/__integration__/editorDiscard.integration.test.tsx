/**
 * Discard while the create is parked, over the REAL outbox (`outboxPort.ts`: the `@kitchensink/sync` mutator, drain and
 * journal behind the editor's port; only `fetch` behind the recipe client is a double).
 *
 * code-reviewer High 1: the editor withdrew the parked create and then queued a delete naming the create's local ref as
 * its dependency. The create was gone, so the delete waited in the journal forever and "not synced" never cleared — on
 * mobile, in AsyncStorage. The fake port in the unit tier cannot show a record STUCK in a journal; this tier can.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
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
            { locale: 'en', port: outbox.port, drafts: NO_DRAFTS, keep: 'disk', onExit, rebindLine: vi.fn() },
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
