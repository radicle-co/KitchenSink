/**
 * One recipe, one create: a second editor opened on a recipe whose create the first editor queued, over the REAL outbox
 * (`outboxPort.ts`: the `@kitchensink/sync` mutator, `appendExclusive`, the drain and its journal; only `fetch` behind
 * the recipe client is a double).
 *
 * Finding 1 of the 2026-10-10 review. The cook presses Back (the editor's unmount queues the create for `local:X`), then
 * Forward or a reload, which opens a second editor on `?draft=local:X` before the create has answered. The second
 * editor met the create on the wire, dropped its number, and never heard its answer; once the synced record had left
 * the log, its next checkpoint created the recipe again. The unit tier's fake port cannot show the second POST reaching
 * the server; this tier counts them.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { RecipeStatus, type RecipeDetail } from '@kitchensink/recipe-core';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DraftMemento, DraftStore } from '../../src/editor/draftStore.js';
import { toDraftValues } from '../../src/editor/draftStore.js';
import { defaultRecipeFormValues } from '../../src/form/values.js';
import { useRecipeEditor, type EditorSeed } from '../../src/hooks/useRecipeEditor.js';
import { makeOutboxPort } from './outboxPort.js';

afterEach(cleanup);

const RECIPE_ID = '00000000-0000-4000-8000-00000000b001';

const NO_DRAFTS: DraftStore = {
    load: async () => undefined,
    save: async () => undefined,
    discard: async () => undefined,
    adopt: async () => undefined,
    clear: async () => undefined,
};

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Recorded {
    readonly method: string;
    readonly path: string;
    readonly body: Record<string, unknown> | undefined;
}

/**
 * A recipe service over a `fetch` double that records every request. A create answers once `releaseCreate` is called
 * (at once when `held` is false); an update answers at the next version; a read answers the created recipe.
 */
function recipeService(held: boolean) {
    const requests: Recorded[] = [];
    let created: RecipeDetail | undefined;
    let releaseCreate: () => void = () => undefined;
    const gate = held ? new Promise<void>((resolve) => (releaseCreate = resolve)) : Promise.resolve();
    const client = new RecipeServiceClient({
        baseUrl: 'https://recipes.test',
        token: 'tok',
        fetch: async (input, init) => {
            const request = new Request(input, init);
            const path = new URL(request.url).pathname;

            if (path === '/health') {
                return json({});
            }

            const text = await request.text();
            const body = text === '' ? undefined : (JSON.parse(text) as Record<string, unknown>);
            requests.push({ method: request.method, path, body });

            if (request.method === 'POST') {
                await gate;
                created = makeRecipeDetail({
                    id: RECIPE_ID,
                    title: String(body?.['title']),
                    status: RecipeStatus.DRAFT,
                    currentVersion: 1,
                });

                return json(created, 201);
            }

            if (request.method === 'PATCH' && created !== undefined) {
                created = { ...created, currentVersion: created.currentVersion + 1 };

                return json(created);
            }

            return created === undefined ? json({ error: { code: 'NOT_FOUND' } }, 404) : json(created);
        },
    });

    return { client, requests, releaseCreate: () => releaseCreate() };
}

/** Two editors of one recipe over one outbox, as Back and Forward (or a reload) leave them. */
function twoEditors(held: boolean) {
    const service = recipeService(held);
    const outbox = makeOutboxPort(service.client);
    const refs: string[] = [];
    const mountEditor = (seed: EditorSeed) =>
        renderHook(() =>
            useRecipeEditor(seed, {
                onRecipeRef: (ref) => refs.push(ref),
                locale: 'en',
                port: outbox.port,
                drafts: NO_DRAFTS,
                keep: 'tabSession',
                onExit: vi.fn(),
                rebindLine: vi.fn(),
                readRecipe: (id) => service.client.getRecipeById(id),
            }),
        );

    /** The first editor: titled, then left by Back, its exit checkpoint queuing the create. Returns its ref. */
    const leaveFirst = async (): Promise<string> => {
        const first = mountEditor({});
        act(() => {
            first.result.current.setField('title', 'Soup');
        });
        act(() => {
            first.result.current.checkpoint('editorExit');
        });
        // Queued (offline) or already sent: either way the create left the editor.
        await waitFor(async () => expect((await outbox.records()).length + service.requests.length).toBeGreaterThan(0));
        first.unmount();

        return refs[0] ?? '';
    };

    /** The device draft the first editor left: what Forward opens. */
    const mementoOf = (ref: string): DraftMemento => ({
        recipeRef: ref,
        baseVersion: null,
        values: toDraftValues({ ...defaultRecipeFormValues(), title: 'Soup' }),
        pendingRebinds: [],
        savedAt: '2026-10-10T09:00:00.000Z',
    });

    const posts = () => service.requests.filter((request) => request.method === 'POST');

    return { ...service, ...outbox, mountEditor, leaveFirst, mementoOf, posts };
}

describe('a second editor of a recipe whose create the first one queued (real outbox)', () => {
    it('⛔ the create on the wire: one POST, the second editor adopts it, and its own edit goes as an update', async () => {
        const world = twoEditors(true);
        const ref = await world.leaveFirst();
        await waitFor(() => expect(world.posts()).toHaveLength(1));

        const second = world.mountEditor({ memento: world.mementoOf(ref) });
        act(() => {
            second.result.current.setField('description', 'Typed after Forward.');
        });
        act(() => {
            second.result.current.checkpoint('sectionChange');
        });
        await act(async () => {
            await Promise.resolve();
        });
        world.releaseCreate();

        await waitFor(() => expect(second.result.current.recipeId).toBe(RECIPE_ID));
        await waitFor(() =>
            expect(world.requests.at(-1)).toMatchObject({
                method: 'PATCH',
                path: `/api/v1/recipes/${RECIPE_ID}`,
                body: { description: 'Typed after Forward.', expectedVersion: 1 },
            }),
        );
        expect(world.posts()).toHaveLength(1);
    });

    it('⛔ the create still pending offline: the second editor`s draft replaces it, and one POST carries that draft', async () => {
        const world = twoEditors(false);
        world.setOnline(false);
        const ref = await world.leaveFirst();

        const second = world.mountEditor({ memento: world.mementoOf(ref) });
        act(() => {
            second.result.current.setField('description', 'Typed after Forward.');
        });
        act(() => {
            second.result.current.checkpoint('sectionChange');
        });
        await waitFor(async () =>
            expect((await world.records()).map((record) => record.payload)).toMatchObject([
                { input: { description: 'Typed after Forward.' } },
            ]),
        );
        world.setOnline(true);

        await waitFor(() => expect(second.result.current.recipeId).toBe(RECIPE_ID));
        await act(async () => {
            await world.idle();
        });
        expect(world.posts()).toHaveLength(1);
        expect(world.posts()[0]?.body).toMatchObject({ title: 'Soup', description: 'Typed after Forward.' });
    });

    it('⛔ the create already synced: the outbox refuses a second one, and the editor reads the recipe and updates it', async () => {
        const world = twoEditors(false);
        const ref = await world.leaveFirst();
        await act(async () => {
            await world.idle();
        });
        expect(await world.records()).toEqual([]);

        const second = world.mountEditor({ memento: world.mementoOf(ref) });
        act(() => {
            second.result.current.setField('description', 'Typed after Forward.');
        });
        act(() => {
            second.result.current.checkpoint('sectionChange');
        });

        await waitFor(() => expect(second.result.current.recipeId).toBe(RECIPE_ID));
        await waitFor(() =>
            expect(world.requests.at(-1)).toMatchObject({
                method: 'PATCH',
                body: { description: 'Typed after Forward.', expectedVersion: 1 },
            }),
        );
        expect(world.posts()).toHaveLength(1);
    });
});
