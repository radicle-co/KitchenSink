/**
 * The visibility Undo outlives its page (plan U7a, decisions/0078 condition 2). The snackbar belongs to the host above
 * the pages, so the cook can leave the collection's screen and press Undo on another page. The Undo carries its own
 * data and its own outcome handling: it is sent after the screen has unmounted, and when what it would undo is gone it
 * says so in a new snackbar and never throws, logs or reaches an error boundary.
 *
 * The error is built by the REAL `RecipeServiceClient` from a stubbed `fetch`, so the status-to-error mapping is the
 * client's own and no test hand-makes an error object. The 404 body is Nest's JSON body. Residual risk, named in the
 * PR: a 404 with no service body (the load balancer's default) is also a `NotFoundError`, so a collection Undo shows
 * "gone" for it.
 */
import { commonMessages } from '@commise/features-core/common';
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { RecipeServiceClient, collectionQueries, type CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import {
    RecipeServiceProvider,
    recipeServiceKeys,
    useRecipeServiceClient,
} from '@kitchensink/recipe-service-client/hooks';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCollectionVisibility } from '../useCollectionVisibility.js';

afterEach(cleanup);

const GONE = commonMessages.en.undoGone;
const FAILED = commonMessages.en.undoFailed;

const detailOf = (visibility: RecipeVisibility): CollectionWithRecipes => ({
    id: 'col_1',
    ownerId: 'usr_1',
    name: 'Dinners',
    visibility,
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    recipes: [],
});

const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Nest's own JSON body for an HTTP exception, which is what the recipe service answers with. */
const NEST_404 = { statusCode: 404, message: 'Collection not found', error: 'Not Found' };

/** What the server does to the SECOND update, the Undo. The first change always succeeds. */
type UndoAnswer = () => Response | Promise<Response>;

/** A `fetch` double: reads see the collection as it stands, the first update lands, the second answers `undo`. */
function serverWhere(undo: UndoAnswer) {
    let visibility: RecipeVisibility = RecipeVisibility.PUBLIC;
    let updates = 0;
    const calls: string[] = [];
    const fetchDouble = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

        calls.push(method);

        if (method === 'GET') {
            return json(200, detailOf(visibility));
        }

        updates += 1;

        if (updates === 1) {
            visibility = RecipeVisibility.PRIVATE;

            return json(200, detailOf(visibility));
        }

        return undo();
    });

    return { fetchDouble: fetchDouble as unknown as typeof fetch, calls };
}

const Screen: FC = () => {
    const { data } = useQuery(collectionQueries(useRecipeServiceClient()).detail('col_1'));
    const control = useCollectionVisibility({ id: 'col_1', paidFeatures: 'granted' });

    return (
        <>
            <p>{`now ${data?.visibility ?? '…'}`}</p>
            <button
                type="button"
                onClick={() => {
                    control.change(RecipeVisibility.PRIVATE);
                }}
            >
                make private
            </button>
        </>
    );
};

/** The collection's screen, and a sibling control that leaves it: the host above both stays. */
const Pages: FC = () => {
    const [onScreen, setOnScreen] = useState(true);

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    setOnScreen(false);
                }}
            >
                leave the page
            </button>
            {onScreen ? <Screen /> : <p>another page</p>}
        </>
    );
};

async function setup(undo: UndoAnswer) {
    const { fetchDouble, calls } = serverWhere(undo);
    const client = new RecipeServiceClient({
        baseUrl: 'https://recipes.example.test',
        token: 'tok',
        fetch: fetchDouble,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <SnackbarHost>
                    <Pages />
                </SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );
    await screen.findByText('now public');
    fireEvent.click(screen.getByRole('button', { name: 'make private' }));
    await screen.findByText('now private');
    fireEvent.click(screen.getByRole('button', { name: 'leave the page' }));
    await screen.findByText('another page');

    return { calls, consoleError, queryClient };
}

/** What was logged, minus React's act() notice: the Undo settles outside a test act, which is no code fault. */
const realErrors = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
    spy.mock.calls.filter(([first]) => !String(first).includes('not wrapped in act'));

/** The Undo has been sent and its mutation settled, with a turn for the `.catch` that follows to have run. */
const undoSettled = async (queryClient: QueryClient): Promise<void> => {
    await vi.waitFor(() => {
        expect(queryClient.isMutating()).toBe(0);
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

const statusText = (): string => screen.getByRole('status').textContent;

describe('the collection visibility Undo, after its page unmounted', () => {
    it('still sends the compensating change, and changes the cache back', async () => {
        const { calls, queryClient } = await setup(() => json(200, detailOf(RecipeVisibility.PUBLIC)));

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(calls.filter((method) => method !== 'GET')).toHaveLength(2);
        });
        await vi.waitFor(() => {
            expect(
                queryClient.getQueryData<CollectionWithRecipes>(recipeServiceKeys.collection('col_1'))?.visibility,
            ).toBe(RecipeVisibility.PUBLIC);
        });
        expect(statusText()).not.toContain(GONE);
    });

    it('shows the gone message, and does not throw or log, for a 404 with its JSON body', async () => {
        const { consoleError } = await setup(() => json(404, NEST_404));

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(statusText()).toBe(GONE);
        });
        expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
        expect(realErrors(consoleError)).toEqual([]);
    });

    it.each([
        ['a 500', () => json(500, { statusCode: 500, message: 'Internal server error' })],
        ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ] as const)('says it could not undo, and not that it is gone, for %s', async (_name, answer) => {
        const { calls, consoleError, queryClient } = await setup(answer);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(calls.filter((method) => method !== 'GET')).toHaveLength(2);
        });
        await undoSettled(queryClient);
        expect(statusText()).toBe(FAILED);
        expect(realErrors(consoleError)).toEqual([]);
    });

    it.each([
        ['a 403', () => json(403, { statusCode: 403, message: 'Forbidden', error: 'Forbidden' })],
        ['a 409', () => json(409, { statusCode: 409, message: 'Conflict', error: 'Conflict' })],
    ] as const)('shows neither message for %s, which a later try cannot fix', async (_name, answer) => {
        const { calls, consoleError, queryClient } = await setup(answer);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(calls.filter((method) => method !== 'GET')).toHaveLength(2);
        });
        await undoSettled(queryClient);
        expect(statusText()).toBe('');
        expect(realErrors(consoleError)).toEqual([]);
    });
});
