/**
 * Integration: a pick carried onto a line, end to end inside the package (`docs/design/rowEditorBlueprint.md`
 * decision 7). Composes the REAL `useLineCommit`, `useRecipeEditor` (its command half), TanStack Query and the real
 * `RecipeServiceClient` with its request and response parsing; only `fetch` is a double (owner ruling 2026-09-20:
 * integration tests mock their dependencies).
 *
 * What only this tier can show: which requests cross the wire, in what order, with what bodies. A stored line on the
 * edit form moves through `POST …/ingredients/{position}/rebind` and never through a save (ADR-0045, lines 265-269);
 * the editor sends it only after a save in flight settles, at the version that save produced; a line the server does
 * not store goes through an admission and a draft transition, and nothing else.
 *
 * Slice 7: the editor's saves go through the outbox now, so the composition carries a REAL outbox (`./outboxPort.ts`,
 * the domain package's mutator and drain) in front of the same client.
 *
 * REWRITTEN (2026-10-09 review, finding 6; owner D1, blueprint A3). The command runs AT ONCE only on a never-published
 * draft, whose writes make no version (ADR-0058), so the immediate-command cases now use a draft, and "the next save"
 * is its next checkpoint. On a PUBLISHED recipe the re-pick is HELD: only the admission crosses the wire, and Save
 * changes sends the rebind and then its one update, in that order — the last describe block.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { RecipeStatus, type RecipeDetail } from '@kitchensink/recipe-core';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, useRebindIngredientLine } from '@kitchensink/recipe-service-client/hooks';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';

import type { DraftAction } from '../../src/form/draftAction.js';
import { applyDraftAction } from '../../src/form/props.js';
import { toRecipeFormValues } from '../../src/form/wire.js';
import { rebindRequestOf, type LineCommitOutcome, type LineCommitPort } from '../../src/hooks/lineCommit.js';
import { useLineCommit, type LineCommit } from '../../src/hooks/useLineCommit.js';
import { useRecipeEditor } from '../../src/hooks/useRecipeEditor.js';
import { useSourceLimit } from '../../src/hooks/useSourceLimit.js';
import type { DraftStore } from '../../src/editor/draftStore.js';
import { makeOutboxPort } from './outboxPort.js';

afterEach(cleanup);

const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const OIL = '00000000-0000-4000-8000-000000000001';
const BRISKET = '00000000-0000-4000-8000-000000000002';
const BRISKET_FLAT = '00000000-0000-4000-8000-000000000003';
const FLAT = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat' }] };

const line = (ingredientId: string, name: string, extra: Record<string, unknown> = {}) => ({
    ingredientId,
    name,
    quantity: { kind: 'exact', value: 2 } as const,
    unit: 'lb',
    isUserEntered: false,
    ...extra,
});

/** The recipe at `version`, its second line on `second`: a never-published draft unless `status` says otherwise. */
const recipeAt = (
    version: number,
    second = line(BRISKET, 'Brisket', { foodId: 'food_brisket' }),
    status: RecipeStatus = RecipeStatus.DRAFT,
): RecipeDetail =>
    makeRecipeDetail({
        id: RECIPE_ID,
        currentVersion: version,
        status,
        ingredients: [line(OIL, 'Olive oil'), second],
    });

const flatAt = (version: number, status: RecipeStatus = RecipeStatus.DRAFT) =>
    recipeAt(version, line(BRISKET_FLAT, 'Brisket', { foodId: 'food_brisket', variant: FLAT }), status);

interface Recorded {
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
}

/** A `fetch` double: answers each API request from `route`, and records it. A route may hold its answer back. */
function stubbedRecipes(route: (method: string, path: string) => Promise<Response>) {
    const requests: Recorded[] = [];
    const client = new RecipeServiceClient({
        baseUrl: 'https://recipes.test',
        token: 'tok',
        fetch: async (input) => {
            const request = input instanceof Request ? input : new Request(input);
            const path = new URL(request.url).pathname;

            // The client's contract-skew probe (`contractSkew.ts`): not a request this suite is about.
            if (path === '/health') {
                return json({});
            }

            const text = await request.text();

            requests.push({ method: request.method, path, body: text === '' ? undefined : JSON.parse(text) });

            return route(request.method, path);
        },
    });

    return { client, requests };
}

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A food client over a `fetch` double: the adopt answers `adopted`'s root, and every other food request is refused, so a
 * suite that reaches food by mistake fails.
 */
function adoptingFood(adopted: { readonly id: string } | undefined, sent: unknown[]): FoodServiceClient {
    return new FoodServiceClient({
        baseUrl: 'https://food.test',
        token: 'tok',
        fetch: async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const path = new URL(request.url).pathname;

            if (path === '/health') {
                return json({});
            }

            if (path === '/api/v1/foods/remote/adopt' && adopted !== undefined) {
                sent.push({ path, body: JSON.parse(await request.text()) as unknown });

                return json(adopted);
            }

            throw new TypeError('unstubbed food request');
        },
    });
}

function providers(client: RecipeServiceClient, queryClient = new QueryClient(), food = adoptingFood(undefined, [])) {
    return ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <FoodServiceProvider client={food} subject="user_cook">
                    {children}
                </FoodServiceProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
}

/** The commit hook as one surface uses it: every pick tagged with the same origin, which this suite does not read. */
function oneSurface(lineCommit: LineCommit<'row'>): { readonly commit: LineCommitPort } {
    return { commit: (pick, target) => lineCommit.commit(pick, target, 'row') };
}

/** A device draft store that keeps nothing: this suite is about the wire. */
const NO_DRAFTS: DraftStore = {
    load: async () => undefined,
    save: async () => undefined,
    discard: async () => undefined,
    adopt: async () => undefined,
    clear: async () => undefined,
};

/** The edit form's composition: the editor (over a real outbox) and the commit hook on its two ports. */
function useEditForm(recipe: RecipeDetail, port: ReturnType<typeof makeOutboxPort>['port']) {
    const rebind = useRebindIngredientLine();
    const editor = useRecipeEditor(
        { recipe },
        {
            locale: 'en',
            port,
            drafts: NO_DRAFTS,
            keep: 'disk',
            onExit: () => undefined,
            rebindLine: (address, target) => rebind.mutateAsync(rebindRequestOf(address, target)),
            readRecipe: async () => {
                throw new Error('readRecipe: this suite`s recipe is stored from the start');
            },
            pastePending: false,
        },
    );
    const lineCommit = oneSurface(
        useLineCommit<'row'>(
            { kind: 'editForm', dispatch: editor.dispatch, command: editor.lineCommand },
            useSourceLimit(),
        ),
    );

    return { editor, lineCommit };
}

const REBIND_PATH = `/api/v1/recipes/${RECIPE_ID}/ingredients/1/rebind`;

/**
 * Commit, then wait for the outcome in a second `act`. The editor sends a command from an effect, and an `act` scope
 * flushes effects only once its callback settles, so awaiting the outcome inside the first scope would never end.
 */
async function commitAndWait(start: () => Promise<LineCommitOutcome>): Promise<LineCommitOutcome> {
    let committed: Promise<LineCommitOutcome> | undefined;

    act(() => {
        committed = start();
    });

    let outcome: LineCommitOutcome | undefined;

    await act(async () => {
        outcome = await committed;
    });

    if (outcome === undefined) {
        throw new Error('the commit did not settle');
    }

    return outcome;
}

describe('useLineCommit on the edit form (integration)', () => {
    // ADR-0055 point 10 and plan 002 S7: a remote pick is ONE client command, food's adopt then the line's own route; on a
    // STORED line that route is the rebind command, never a plain save.
    it('a remote pick on a STORED line: food adopts it, then the rebind command re-points the line to that root', async () => {
        const adopts: unknown[] = [];
        const { client, requests } = stubbedRecipes(async (method, path) =>
            method === 'POST' && path === REBIND_PATH ? json(flatAt(4)) : json(recipeAt(5)),
        );
        const { port } = makeOutboxPort(client);
        const { result } = renderHook(() => useEditForm(recipeAt(3), port), {
            wrapper: providers(client, new QueryClient(), adoptingFood({ id: 'food_stewed' }, adopts)),
        });
        const key = result.current.editor.values.ingredients[1]!.key;
        const outcome = await commitAndWait(() =>
            result.current.lineCommit.commit(
                { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' },
                { kind: 'line', key },
            ),
        );

        expect(adopts).toEqual([{ path: '/api/v1/foods/remote/adopt', body: { reference: 'sealed.s' } }]);
        expect(requests).toEqual([
            {
                method: 'POST',
                path: REBIND_PATH,
                body: { expectedVersion: 3, target: { kind: 'catalogFood', foodId: 'food_stewed' } },
            },
        ]);
        expect(outcome).toMatchObject({ kind: 'committed', key });
    });

    it('re-points a STORED line through the rebind command — no save — and the next save names the version it made', async () => {
        const { client, requests } = stubbedRecipes(async (method, path) =>
            method === 'POST' && path === REBIND_PATH ? json(flatAt(4)) : json(recipeAt(5)),
        );
        const { port } = makeOutboxPort(client);
        const { result } = renderHook(() => useEditForm(recipeAt(3), port), { wrapper: providers(client) });
        const key = result.current.editor.values.ingredients[1]!.key;
        const outcome = await commitAndWait(() =>
            result.current.lineCommit.commit(
                { kind: 'catalogVariant', foodVariantId: 'var_flat' },
                { kind: 'line', key },
            ),
        );

        expect(requests).toEqual([
            {
                method: 'POST',
                path: REBIND_PATH,
                body: { expectedVersion: 3, target: { kind: 'catalogVariant', foodVariantId: 'var_flat' } },
            },
        ]);
        expect(outcome).toMatchObject({
            kind: 'committed',
            key,
            binding: { ingredientId: BRISKET_FLAT, variant: FLAT },
        });
        expect(result.current.editor.values.ingredients[1]).toMatchObject({
            key,
            ingredientId: BRISKET_FLAT,
            variant: FLAT,
        });

        act(() => {
            result.current.editor.setField('description', 'Edited.');
        });
        act(() => {
            result.current.editor.checkpoint('sectionChange');
        });
        await waitFor(() => expect(requests).toHaveLength(2));
        expect(requests[1]).toMatchObject({ method: 'PATCH', body: { expectedVersion: 4 } });
    });

    it('⛔ waits for the save in flight, then sends at the version that save produced', async () => {
        let answerSave: ((response: Response) => void) | undefined;
        const { client, requests } = stubbedRecipes((method, path) => {
            if (method === 'PATCH') {
                return new Promise((resolve) => {
                    answerSave = resolve;
                });
            }

            return Promise.resolve(method === 'POST' && path === REBIND_PATH ? json(flatAt(5)) : json(recipeAt(9)));
        });
        const { port } = makeOutboxPort(client);
        const { result } = renderHook(() => useEditForm(recipeAt(3), port), { wrapper: providers(client) });
        const key = result.current.editor.values.ingredients[1]!.key;
        let committed: Promise<LineCommitOutcome> | undefined;

        act(() => {
            result.current.editor.setField('description', 'Edited.');
        });
        act(() => {
            result.current.editor.checkpoint('sectionChange');
        });
        await waitFor(() => expect(requests.map((r) => r.method)).toEqual(['PATCH']));
        await act(async () => {
            committed = result.current.lineCommit.commit(
                { kind: 'catalogVariant', foodVariantId: 'var_flat' },
                {
                    kind: 'line',
                    key,
                },
            );
        });

        expect(requests.map((r) => r.method)).toEqual(['PATCH']);

        // ⚠️ Answered in one `act` and awaited in the next: the command goes out from an effect that the save's answer
        // enables, and `act` flushes effects only once its callback settles.
        await act(async () => {
            answerSave?.(json(recipeAt(4)));
        });
        await waitFor(() => expect(requests.map((r) => r.method)).toEqual(['PATCH', 'POST']));
        await act(async () => {
            await committed;
        });

        expect(requests.map((r) => [r.method, r.path])).toEqual([
            ['PATCH', `/api/v1/recipes/${RECIPE_ID}`],
            ['POST', REBIND_PATH],
        ]);
        expect(requests[1]?.body).toMatchObject({ expectedVersion: 4 });
    });

    it('a 409 from the command opens the conflict view and sends no save', async () => {
        const server = {
            versionNumber: 6,
            updatedAt: '2026-10-02T09:00:00.000Z',
            snapshot: {
                version: 6,
                title: 'Renamed elsewhere',
                description: '',
                steps: [],
                ingredients: [],
                servings: 4,
                prepTimeMinutes: 10,
                cookTimeMinutes: 20,
            },
        };
        const { client, requests } = stubbedRecipes(async () =>
            json(
                {
                    code: 'VERSION_CONFLICT',
                    message: 'conflict',
                    details: { currentVersion: 6, conflictingVersion: 3, server },
                },
                409,
            ),
        );
        const { port } = makeOutboxPort(client);
        const { result } = renderHook(() => useEditForm(recipeAt(3), port), { wrapper: providers(client) });
        const outcome = await commitAndWait(() =>
            result.current.lineCommit.commit(
                { kind: 'catalogVariant', foodVariantId: 'var_flat' },
                { kind: 'line', key: result.current.editor.values.ingredients[1]!.key },
            ),
        );

        expect(outcome).toEqual({ kind: 'conflict' });
        expect(result.current.editor.state.status).toBe('conflict');
        expect(requests.map((r) => r.method)).toEqual(['POST']);
    });

    it('a line added this session goes through an admission and the draft, and nothing else', async () => {
        const admitted = {
            id: BRISKET_FLAT,
            name: 'Brisket',
            foodId: 'food_brisket',
            variant: FLAT,
            foodResolutionStatus: 'RESOLVED',
            isUserEntered: false,
            createdAt: '2026-10-02T09:00:00.000Z',
        };
        const { client, requests } = stubbedRecipes(async () => json(admitted));
        const { port } = makeOutboxPort(client);
        const { result } = renderHook(() => useEditForm(recipeAt(3), port), { wrapper: providers(client) });

        await act(async () => {
            await result.current.lineCommit.commit(
                { kind: 'catalogFood', foodId: 'food_brisket', name: 'Brisket' },
                {
                    kind: 'newLine',
                },
            );
        });

        expect(requests.map((r) => [r.method, r.path, r.body])).toEqual([
            ['POST', '/api/v1/ingredients/by-food', { foodId: 'food_brisket' }],
        ]);
        expect(result.current.editor.values.ingredients).toHaveLength(3);
        expect(result.current.editor.values.ingredients[2]).toMatchObject({
            ingredientId: BRISKET_FLAT,
            variant: FLAT,
        });
    });
});

describe('a re-pick on a PUBLISHED recipe waits for Save changes (integration)', () => {
    const published = (version: number) => recipeAt(version, undefined, RecipeStatus.PUBLISHED);
    const admitted = {
        id: BRISKET_FLAT,
        name: 'Brisket',
        foodId: 'food_brisket',
        variant: FLAT,
        foodResolutionStatus: 'RESOLVED',
        isUserEntered: false,
        createdAt: '2026-10-02T09:00:00.000Z',
    };

    /** The admission, the rebind and the save, each answered as the server would. */
    function server() {
        return stubbedRecipes(async (method, path) => {
            if (path === '/api/v1/ingredients/by-food-variant') {
                return json(admitted);
            }

            if (method === 'POST' && path === REBIND_PATH) {
                return json(flatAt(4, RecipeStatus.PUBLISHED));
            }

            return json({ ...flatAt(5, RecipeStatus.PUBLISHED), description: 'Edited.' });
        });
    }

    it('only the admission crosses the wire at the pick; Save changes sends the rebind, then ONE update, in order', async () => {
        const { client, requests } = server();
        const { port } = makeOutboxPort(client);
        const { result } = renderHook(() => useEditForm(published(3), port), { wrapper: providers(client) });
        const key = result.current.editor.values.ingredients[1]!.key;

        const outcome = await commitAndWait(() =>
            result.current.lineCommit.commit(
                { kind: 'catalogVariant', foodVariantId: 'var_flat' },
                { kind: 'line', key },
            ),
        );

        expect(outcome).toMatchObject({ kind: 'committed', key });
        expect(requests.map((r) => [r.method, r.path])).toEqual([['POST', '/api/v1/ingredients/by-food-variant']]);
        expect(result.current.editor.values.ingredients[1]).toMatchObject({ key, ingredientId: BRISKET_FLAT });

        act(() => {
            result.current.editor.setField('description', 'Edited.');
        });
        act(() => {
            result.current.editor.saveChanges('');
        });
        await waitFor(() => expect(requests).toHaveLength(3));

        expect(requests.slice(1).map((r) => [r.method, r.path, r.body])).toEqual([
            [
                'POST',
                REBIND_PATH,
                { expectedVersion: 3, target: { kind: 'catalogVariant', foodVariantId: 'var_flat' } },
            ],
            ['PATCH', `/api/v1/recipes/${RECIPE_ID}`, expect.objectContaining({ expectedVersion: 4 })],
        ]);
    });

    it('Discard after a held re-pick sends nothing to the recipe', async () => {
        const { client, requests } = server();
        const { port } = makeOutboxPort(client);
        const { result } = renderHook(() => useEditForm(published(3), port), { wrapper: providers(client) });
        const key = result.current.editor.values.ingredients[1]!.key;

        await commitAndWait(() =>
            result.current.lineCommit.commit(
                { kind: 'catalogVariant', foodVariantId: 'var_flat' },
                { kind: 'line', key },
            ),
        );
        act(() => {
            result.current.editor.discard();
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(requests.map((r) => [r.method, r.path])).toEqual([['POST', '/api/v1/ingredients/by-food-variant']]);
    });
});

describe('useLineCommit on the create form (integration)', () => {
    it('a details variant is admitted by its variant id, then re-points the line in the draft', async () => {
        const admitted = {
            id: BRISKET_FLAT,
            name: 'Brisket',
            foodId: 'food_brisket',
            variant: FLAT,
            foodResolutionStatus: 'RESOLVED',
            isUserEntered: false,
            createdAt: '2026-10-02T09:00:00.000Z',
        };
        const { client, requests } = stubbedRecipes(async () => json(admitted));
        const seeded = toRecipeFormValues(recipeAt(1));
        const { result } = renderHook(
            () => {
                const [values, setValues] = useState(seeded);
                const lineCommit = oneSurface(
                    useLineCommit<'row'>(
                        {
                            kind: 'createForm',
                            dispatch: (action: DraftAction) =>
                                setValues((current) => applyDraftAction(current, action)),
                        },
                        useSourceLimit(),
                    ),
                );

                return { values, lineCommit };
            },
            { wrapper: providers(client) },
        );
        const key = result.current.values.ingredients[1]!.key;

        await act(async () => {
            await result.current.lineCommit.commit(
                { kind: 'catalogVariant', foodVariantId: 'var_flat' },
                { kind: 'line', key },
            );
        });

        expect(requests.map((r) => [r.method, r.path, r.body])).toEqual([
            ['POST', '/api/v1/ingredients/by-food-variant', { foodVariantId: 'var_flat' }],
        ]);
        expect(result.current.values.ingredients[1]).toMatchObject({
            key,
            ingredientId: BRISKET_FLAT,
            variant: FLAT,
            quantity: 2,
            unit: 'lb',
        });
    });
});
