/**
 * The version restore's Undo outlives its page (plan U7a, decisions/0078 condition 2): the snackbar belongs to the host
 * above the pages, so the cook can leave the history screen and press Undo elsewhere. The Undo still sends its restore,
 * and when the recipe is gone it says so in a snackbar of its own. A restore that conflicts refetches the history by
 * id, not through the unmounted screen's queries.
 *
 * Errors come from the REAL `RecipeServiceClient` over a stubbed `fetch` that answers with Nest's JSON body, so no test
 * makes an error object by hand.
 */
import { commonMessages } from '@commise/features-core/common';
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeRecipeDetail, makeRecipeVersion } from '@kitchensink/recipe-core/testing';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import { Suspense, useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRecipeVersions } from '../useRecipeVersions.js';

afterEach(cleanup);

const GONE = commonMessages.en.undoGone;
const FAILED = commonMessages.en.undoFailed;

const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const NEST_404 = { statusCode: 404, message: 'Recipe not found', error: 'Not Found' };

type UndoAnswer = () => Response | Promise<Response>;

/** The first restore lands. The second (the Undo) answers `undo`. Reads answer with a three-version history. */
function serverWhere(undo: UndoAnswer) {
    let restores = 0;
    const restorePosts: string[] = [];
    const fetchDouble = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);

        if (/\/versions\/\d+\/restore$/.test(url)) {
            restores += 1;
            restorePosts.push(url);

            return restores === 1
                ? json(200, {
                      recipe: makeRecipeDetail({ currentVersion: 4 }),
                      restoredFromVersion: 1,
                      currentVersion: 4,
                  })
                : undo();
        }

        if (/\/health$/.test(url)) {
            return json(200, { status: 'ok' });
        }

        return /\/versions$/.test(url)
            ? json(
                  200,
                  [1, 2, 3].map((versionNumber) =>
                      makeRecipeVersion({ id: `ver_${String(versionNumber)}`, versionNumber }),
                  ),
              )
            : json(200, makeRecipeDetail({ currentVersion: 3 }));
    });

    return { fetchDouble: fetchDouble as unknown as typeof fetch, restorePosts };
}

const History: FC = () => {
    const session = useRecipeVersions({ recipeId: 'rec_1' });

    return (
        <button
            type="button"
            onClick={() => {
                session.list.onRestore(1);
            }}
        >
            restore version 1
        </button>
    );
};

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
            {onScreen ? (
                <Suspense fallback={<p>loading</p>}>
                    <History />
                </Suspense>
            ) : (
                <p>another page</p>
            )}
        </>
    );
};

async function setup(undo: UndoAnswer) {
    const { fetchDouble, restorePosts } = serverWhere(undo);
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
    fireEvent.click(await screen.findByRole('button', { name: 'restore version 1' }));
    await screen.findByRole('button', { name: 'Undo' });
    fireEvent.click(screen.getByRole('button', { name: 'leave the page' }));
    await screen.findByText('another page');

    return { restorePosts, consoleError, queryClient };
}

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

/** What was logged, minus React's act() notice: the Undo settles outside any test act, which is no fault of the code. */
const realErrors = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
    spy.mock.calls.filter(([first]) => !String(first).includes('not wrapped in act'));

describe('the version restore Undo, after its page unmounted', () => {
    it('still sends the restore of the version that was current', async () => {
        const { restorePosts } = await setup(() =>
            json(200, { recipe: makeRecipeDetail({ currentVersion: 5 }), restoredFromVersion: 3, currentVersion: 5 }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(restorePosts).toHaveLength(2);
        });
        expect(restorePosts[1]).toMatch(/\/versions\/3\/restore$/);
    });

    it('shows the gone message, and does not throw or log, when the server answers 404 with its JSON body', async () => {
        const { consoleError } = await setup(() => json(404, NEST_404));

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(statusText()).toBe(GONE);
        });
        expect(realErrors(consoleError)).toEqual([]);
    });

    it('marks the recipe and its history stale by id after a 409, and shows neither message', async () => {
        const { queryClient, consoleError } = await setup(() =>
            json(409, { statusCode: 409, message: 'Version conflict', error: 'Conflict' }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(queryClient.getQueryState(recipeServiceKeys.recipe('rec_1'))?.isInvalidated).toBe(true);
            expect(queryClient.getQueryState(recipeServiceKeys.recipeVersions('rec_1'))?.isInvalidated).toBe(true);
        });
        await undoSettled(queryClient);
        expect(statusText()).toBe('');
        expect(realErrors(consoleError)).toEqual([]);
    });

    it.each([
        ['a 500', () => json(500, { statusCode: 500, message: 'Internal server error' })],
        ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ] as const)('says it could not undo, and not that it is gone, for %s', async (_name, answer) => {
        const { consoleError, restorePosts, queryClient } = await setup(answer);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(restorePosts).toHaveLength(2);
        });
        await undoSettled(queryClient);
        expect(statusText()).toBe(FAILED);
        expect(realErrors(consoleError)).toEqual([]);
    });

    it('shows neither message for a 403, which a later try cannot fix', async () => {
        const { consoleError, restorePosts, queryClient } = await setup(() =>
            json(403, { statusCode: 403, message: 'Forbidden', error: 'Forbidden' }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        await vi.waitFor(() => {
            expect(restorePosts).toHaveLength(2);
        });
        await undoSettled(queryClient);
        expect(statusText()).toBe('');
        expect(realErrors(consoleError)).toEqual([]);
    });
});
