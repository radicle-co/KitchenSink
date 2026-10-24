/**
 * Integration: what a collection's members cost on the wire (slice 5; `docs/architecture/uiOverhaulBlueprint.md` A15).
 *
 * Composes the REAL hooks (`useMemberToggle`, `useMemberRemoval`), the real picker row and member list leaves, TanStack
 * Query, the design system's `SnackbarHost` and the real `RecipeServiceClient` (its request building and zod parsing),
 * with only `fetch` doubled. What it proves that no unit test can: the requests that LEAVE the device.
 *
 * - A fast on, off, on of one row reaches the server in that order, one at a time (the scope serializes the pair).
 * - A removal sends NOTHING until its Undo snackbar commits; Undo sends nothing at all; and a removal whose screen is gone
 *   is still sent, because the commit lives in the hook's mutation options and the snackbar host outlives the screen.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { makeRecipe } from '@kitchensink/recipe-core/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CollectionPickerRow } from '../../src/collections/CollectionPickerRow.js';
import { useMemberRemoval } from '../../src/hooks/useMemberRemoval.js';
import { useMemberToggle } from '../../src/hooks/useMemberToggle.js';

const COLLECTION = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Dinners' };
const soup = makeRecipe({ id: '00000000-0000-4000-8000-000000000003', title: 'Tomato Soup' });

interface Sent {
    readonly method: string;
    readonly path: string;
}

/** A deferred response, so a test can hold one request open while it presses again. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });

    return { promise, resolve };
}

/** The wire double: it records each request and answers the way recipe-service does. */
function wire(holdFirstAdd?: Promise<void>) {
    const sent: Sent[] = [];
    let adds = 0;

    // The client calls `fetch` with a `Request` for some methods and with a URL and an init for others.
    const fetchDouble = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
        const path = new URL(url).pathname;

        // The client's contract-skew probe is off-pipeline and unauthenticated; it is not a request the feature made.
        if (path === '/health') {
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        }

        sent.push({ method, path });

        if (method === 'DELETE') {
            return new Response(null, { status: 204 });
        }

        adds += 1;

        if (adds === 1 && holdFirstAdd !== undefined) {
            await holdFirstAdd;
        }

        return new Response(
            JSON.stringify({
                collectionId: COLLECTION.id,
                recipeId: '00000000-0000-4000-8000-000000000003',
                addedVia: 'manual',
                createdAt: '2026-10-01T00:00:00.000Z',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
        );
    };

    return {
        sent,
        client: new RecipeServiceClient({ baseUrl: 'https://recipes.test', token: 'tok', fetch: fetchDouble }),
    };
}

function shell(client: RecipeServiceClient, children: React.ReactNode) {
    return (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <RecipeServiceProvider client={client}>
                <SnackbarHost>{children}</SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
}

beforeEach(() => {
    // The picker row announces nothing itself; the snackbar host reads the screen-reader state from the platform.
    vi.useRealTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** One picker row, as a host draws it: the checkbox is the user's way to press the hook. */
const Row: FC = () => {
    const toggle = useMemberToggle(COLLECTION.id, soup);
    const [checked, setChecked] = useState(false);

    return (
        <CollectionPickerRow
            recipe={soup}
            checked={checked}
            onToggle={(next) => {
                setChecked(next);
                toggle.press(next);
            }}
        />
    );
};

describe('the picker row on the wire (integration)', () => {
    it('sends on, off, on in that order and one at a time, however fast the presses come', async () => {
        const user = userEvent.setup();
        const held = deferred<void>();
        const { sent, client } = wire(held.promise);
        render(shell(client, <Row />));
        const box = screen.getByRole('checkbox', { name: 'Tomato Soup' });

        await user.click(box);
        await user.click(box);
        await user.click(box);

        // The first POST is still open: the DELETE and the second POST wait behind it, they are not in flight with it.
        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]).toEqual({
            method: 'POST',
            path: '/api/v1/collections/00000000-0000-4000-8000-0000000000c1/recipes',
        });

        await act(async () => {
            held.resolve();
        });

        await waitFor(() => expect(sent).toHaveLength(3));
        expect(sent.map((request) => request.method)).toEqual(['POST', 'DELETE', 'POST']);
        expect(sent[1]?.path).toBe(
            '/api/v1/collections/00000000-0000-4000-8000-0000000000c1/recipes/00000000-0000-4000-8000-000000000003',
        );
    });
});

/** A member list's removal, as the detail screen wires it; unmountable on its own, the host stays. */
const Removal: FC = () => {
    const removal = useMemberRemoval(COLLECTION);

    return (
        <button
            type="button"
            onClick={() => removal.remove({ id: '00000000-0000-4000-8000-000000000003', title: 'Tomato Soup' })}
        >
            Remove Tomato Soup
        </button>
    );
};

describe('removing a member on the wire (integration)', () => {
    it('sends nothing on press, nothing on Undo, and the removal once the snackbar times out', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
        const { sent, client } = wire();
        render(shell(client, <Removal />));

        await user.click(screen.getByRole('button', { name: 'Remove Tomato Soup' }));
        expect(await screen.findByText('Removed Tomato Soup from Dinners.')).toBeTruthy();
        expect(sent).toEqual([]);

        await user.click(screen.getByRole('button', { name: 'Undo' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(7000);
        });
        expect(sent).toEqual([]);

        await user.click(screen.getByRole('button', { name: 'Remove Tomato Soup' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(7000);
        });

        await waitFor(() =>
            expect(sent).toEqual([
                {
                    method: 'DELETE',
                    path: '/api/v1/collections/00000000-0000-4000-8000-0000000000c1/recipes/00000000-0000-4000-8000-000000000003',
                },
            ]),
        );
    });

    it('still sends the removal when the screen that asked for it is gone', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
        const { sent, client } = wire();

        const Screen: FC = () => {
            const [shown, setShown] = useState(true);

            return (
                <>
                    {shown ? <Removal /> : null}
                    <button type="button" onClick={() => setShown(false)}>
                        Leave
                    </button>
                </>
            );
        };

        render(shell(client, <Screen />));

        await user.click(screen.getByRole('button', { name: 'Remove Tomato Soup' }));
        await user.click(screen.getByRole('button', { name: 'Leave' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(7000);
        });

        await waitFor(() =>
            expect(sent).toEqual([
                {
                    method: 'DELETE',
                    path: '/api/v1/collections/00000000-0000-4000-8000-0000000000c1/recipes/00000000-0000-4000-8000-000000000003',
                },
            ]),
        );
    });
});
